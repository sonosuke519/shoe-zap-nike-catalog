import {validateSnapshot,reconcileNike,CatalogError} from './nike-catalog.mjs';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
async function authorized(request,key){
 if(!key||key.length<32)return false;const token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)return false;
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export async function nikeEndpoint(request,env){
 const path=new URL(request.url).pathname;if(!['/api/nike/catalog','/api/nike/sync'].includes(path))return null;
 if(path==='/api/nike/sync'&&!await authorized(request,env.NIKE_SYNC_KEY))return reply({error:'unauthorized'},401);
 if((path.endsWith('/catalog')&&request.method!=='GET')||(path.endsWith('/sync')&&request.method!=='POST'))return reply({error:'method_not_allowed'},405);
 if(!env.DB)return reply({error:'catalog_storage_unavailable'},503);
 const db=env.DB;
 try{
  if(path.endsWith('/catalog')){
   const [state,runs]=await Promise.all([db.prepare("SELECT revision, updated_at, data_json FROM nike_catalog_state WHERE id='nike-jp'").first(),db.prepare('SELECT id,status,checked_at,summary_json FROM nike_catalog_runs ORDER BY checked_at DESC LIMIT 12').all()]);
   return reply({revision:state?.revision||0,updatedAt:state?.updated_at||null,...(state?JSON.parse(state.data_json):{variants:[],coverage:[],summary:null}),runs:(runs.results||[]).map(r=>({id:r.id,status:r.status,checkedAt:r.checked_at,...JSON.parse(r.summary_json)})),scheduleEnabled:env.NIKE_SYNC_SCHEDULE_ENABLED==='true',scheduleLabel:'毎日 06:17（日本時間）',sizeNotice:'サイズ展開・サイズ別在庫は未取得です。掲載状態は購入可能なサイズの保証ではありません。'});
  }
  if(Number(request.headers.get('content-length'))>1_800_000)return reply({error:'snapshot_too_large'},413);
  const text=await request.text();if(text.length>1_800_000)return reply({error:'snapshot_too_large'},413);
  let input;try{input=JSON.parse(text);}catch{return reply({error:'invalid_json'},400);}
  if(!/^[a-z0-9-]{16,80}$/i.test(input?.syncId||''))return reply({error:'invalid_snapshot'},400);
  const existing=await db.prepare('SELECT status, summary_json FROM nike_catalog_runs WHERE id=?').bind(input.syncId).first();
  if(existing)return reply({status:existing.status,replayed:true,...JSON.parse(existing.summary_json)});
  const now=new Date().toISOString();
  const recordFailure=async error=>{
   await db.prepare('INSERT INTO nike_catalog_runs(id,status,checked_at,summary_json) VALUES(?,?,?,?)').bind(input.syncId,'failed',now,JSON.stringify({error})).run();
   return reply({status:'failed',error},422);
  };
  if(input.status==='failed')return recordFailure(/^[a-z_]{3,60}$/.test(input.errorCode)?input.errorCode:'collector_failed');
  validateSnapshot(input);
  const old=await db.prepare("SELECT revision,data_json FROM nike_catalog_state WHERE id='nike-jp'").first();
  const revision=old?.revision||0,previous=old?JSON.parse(old.data_json).variants:[];
  if(old&&Date.parse(input.collectedAt)<Date.parse(JSON.parse(old.data_json).collectedAt))return reply({error:'older_snapshot_rejected'},409);
  let result;try{result=reconcileNike(previous,input,{baseline:!old});}catch(error){if(error instanceof CatalogError)return recordFailure(error.code);throw error;}
  const data=JSON.stringify({variants:result.variants,coverage:input.coverage,summary:result.summary,collectedAt:input.collectedAt,changes:result.changes});
  if(data.length>1_600_000)return recordFailure('catalog_capacity_reached');
  const summary={...result.summary,changes:result.changes,collectedAt:input.collectedAt,coverage:input.coverage};
  const writes=await db.batch([
   db.prepare("INSERT INTO nike_catalog_state(id,revision,sync_id,updated_at,data_json) VALUES('nike-jp',?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,sync_id=excluded.sync_id,updated_at=excluded.updated_at,data_json=excluded.data_json WHERE nike_catalog_state.revision=?").bind(revision+1,input.syncId,now,data,revision),
   db.prepare("INSERT INTO nike_catalog_runs(id,status,checked_at,summary_json) SELECT ?,'ok',?,? WHERE EXISTS(SELECT 1 FROM nike_catalog_state WHERE id='nike-jp' AND revision=? AND sync_id=?)").bind(input.syncId,now,JSON.stringify(summary),revision+1,input.syncId)
  ]);
  if(!writes[0]?.meta?.changes)return reply({error:'concurrent_update_retry'},409);
  return reply({status:'ok',revision:revision+1,...result.summary,checkedAt:now});
 }catch(error){return reply({error:error instanceof CatalogError?error.code:'catalog_operation_failed'},error instanceof CatalogError?400:500);}
}
