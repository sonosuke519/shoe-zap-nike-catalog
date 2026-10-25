import {validateSnapshot,reconcileNike,CatalogError} from './nike-catalog.mjs';
import {validateAdidasSnapshot,ADIDAS_SOURCE} from './adidas-catalog.mjs';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
async function authorized(request,key){
 if(!key||key.length<32)return false;const token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)return false;
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export async function nikeEndpoint(request,env){
 const path=new URL(request.url).pathname,match=path.match(/^\/api\/(nike|adidas)\/(catalog|sync|source-page)$/);if(!match)return null;
 const brand=match[1],action=match[2],stateId=brand+'-jp';if(action==='source-page'&&brand!=='adidas')return null;
 if(action!=='catalog'&&!await authorized(request,env.NIKE_SYNC_KEY))return reply({error:'unauthorized'},401);
 if((action==='catalog'&&request.method!=='GET')||(action!=='catalog'&&request.method!=='POST'))return reply({error:'method_not_allowed'},405);
 if(action==='source-page')return adidasSourcePage(request,env);
 if(!env.DB)return reply({error:'catalog_storage_unavailable'},503);
 const db=env.DB;
 try{
  if(path.endsWith('/catalog')){
   const [state,runs]=await Promise.all([db.prepare('SELECT revision, updated_at, data_json FROM nike_catalog_state WHERE id=?').bind(stateId).first(),db.prepare('SELECT id,status,checked_at,summary_json FROM nike_catalog_runs WHERE brand=? ORDER BY checked_at DESC LIMIT 12').bind(brand).all()]);
   return reply({brand,sourceLabel:brand==='adidas'?ADIDAS_SOURCE.label:'ナイキ公式サイト',sourceURL:brand==='adidas'?ADIDAS_SOURCE.url:'https://www.nike.com/jp/',revision:state?.revision||0,updatedAt:state?.updated_at||null,...(state?JSON.parse(state.data_json):{variants:[],coverage:[],summary:null}),runs:(runs.results||[]).map(r=>({id:r.id,status:r.status,checkedAt:r.checked_at,...JSON.parse(r.summary_json)})),scheduleEnabled:env[brand.toUpperCase()+'_SYNC_SCHEDULE_ENABLED']==='true',scheduleLabel:'毎日 06:17（日本時間）',sizeNotice:'サイズ展開・サイズ別在庫は未取得です。掲載状態は購入可能なサイズの保証ではありません。'});
  }
  if(Number(request.headers.get('content-length'))>1_800_000)return reply({error:'snapshot_too_large'},413);
  const text=await request.text();if(text.length>1_800_000)return reply({error:'snapshot_too_large'},413);
  let input;try{input=JSON.parse(text);}catch{return reply({error:'invalid_json'},400);}
  if(!/^[a-z0-9-]{16,80}$/i.test(input?.syncId||''))return reply({error:'invalid_snapshot'},400);
  const existing=await db.prepare('SELECT status, summary_json FROM nike_catalog_runs WHERE id=? AND brand=?').bind(input.syncId,brand).first();
  if(existing)return reply({status:existing.status,replayed:true,...JSON.parse(existing.summary_json)});
  const now=new Date().toISOString();
  const recordFailure=async error=>{
   await db.prepare('INSERT INTO nike_catalog_runs(id,brand,status,checked_at,summary_json) VALUES(?,?,?,?,?)').bind(input.syncId,brand,'failed',now,JSON.stringify({error})).run();
   return reply({status:'failed',error},422);
  };
  if(input.status==='failed')return recordFailure(/^[a-z_]{3,60}$/.test(input.errorCode)?input.errorCode:'collector_failed');
  (brand==='adidas'?validateAdidasSnapshot:validateSnapshot)(input);
  const old=await db.prepare('SELECT revision,data_json FROM nike_catalog_state WHERE id=?').bind(stateId).first();
  const revision=old?.revision||0,previous=old?JSON.parse(old.data_json).variants:[];
  if(old&&Date.parse(input.collectedAt)<Date.parse(JSON.parse(old.data_json).collectedAt))return reply({error:'older_snapshot_rejected'},409);
  let result;try{result=reconcileNike(previous,input,{baseline:!old});}catch(error){if(error instanceof CatalogError)return recordFailure(error.code);throw error;}
  const data=JSON.stringify({variants:result.variants,coverage:input.coverage,summary:result.summary,collectedAt:input.collectedAt,changes:result.changes});
  if(data.length>1_600_000)return recordFailure('catalog_capacity_reached');
  const summary={...result.summary,changes:result.changes,collectedAt:input.collectedAt,coverage:input.coverage};
  const writes=await db.batch([
   db.prepare('INSERT INTO nike_catalog_state(id,revision,sync_id,updated_at,data_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,sync_id=excluded.sync_id,updated_at=excluded.updated_at,data_json=excluded.data_json WHERE nike_catalog_state.revision=?').bind(stateId,revision+1,input.syncId,now,data,revision),
   db.prepare("INSERT INTO nike_catalog_runs(id,brand,status,checked_at,summary_json) SELECT ?,?,'ok',?,? WHERE EXISTS(SELECT 1 FROM nike_catalog_state WHERE id=? AND revision=? AND sync_id=?)").bind(input.syncId,brand,now,JSON.stringify(summary),stateId,revision+1,input.syncId)
  ]);
  if(!writes[0]?.meta?.changes)return reply({error:'concurrent_update_retry'},409);
  return reply({status:'ok',revision:revision+1,...result.summary,checkedAt:now});
 }catch(error){return reply({error:error instanceof CatalogError?error.code:'catalog_operation_failed'},error instanceof CatalogError?400:500);}
}
async function adidasSourcePage(request,env){
 if(!env.RAKUTEN_APPLICATION_ID||!env.RAKUTEN_ACCESS_KEY)return reply({error:'source_not_configured'},503);
 try{
  const text=await request.text();if(text.length>1000)return reply({error:'invalid_request'},400);const {page}=JSON.parse(text);if(!Number.isInteger(page)||page<1||page>100)return reply({error:'invalid_request'},400);
  const u=new URL('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701');u.search=new URLSearchParams({applicationId:env.RAKUTEN_APPLICATION_ID,shopCode:'adidas',keyword:ADIDAS_SOURCE.keyword,hits:'30',page:String(page),sort:'+updateTimestamp',availability:'0',format:'json'});
  const origin=env.RAKUTEN_ALLOWED_ORIGIN||'https://shoe-zap-27-prototype.ponpokoponnosuke.chatgpt.site';
  const response=await fetch(u,{headers:{accessKey:env.RAKUTEN_ACCESS_KEY,Origin:origin,Referer:origin+'/'},signal:AbortSignal.timeout(25000)});
  if(!response.ok)return reply({error:response.status===429?'source_rate_limited':'source_unavailable'},502);const j=await response.json();
  const fields=['itemCode','itemName','itemCaption','itemUrl','itemPrice','availability','taxFlag','shopCode','shopName','genreId','mediumImageUrls'];
  return reply({page:j.page,count:j.count,pageCount:j.pageCount,items:(j.Items||[]).map(v=>Object.fromEntries(fields.map(k=>[k,(v.Item||v)[k]])))});
 }catch{return reply({error:'source_unavailable'},502);}
}
