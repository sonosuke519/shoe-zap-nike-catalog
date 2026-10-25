import {authorized} from './nike-endpoints.mjs';
import {matchRakutenItems,marketSummary,merchantURL,filterOffersBySize,MARKET_PAGE_LIMIT,MARKET_SOURCE} from './nike-market.mjs';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
async function catalog(db){const row=await db.prepare('SELECT data_json FROM nike_catalog_state WHERE id=?').bind('nike-jp').first();return row?JSON.parse(row.data_json).variants.filter(v=>!v.missingSince):[];}
export async function nikeMarketEndpoint(request,env){
 const u=new URL(request.url),action={'/api/nike/shops':'read','/api/nike/shops-source':'source','/api/nike/shops-sync':'sync'}[u.pathname];if(!action)return null;
 if(action!=='read'&&!await authorized(request,env.NIKE_SYNC_KEY))return reply({error:'unauthorized'},401);
 if(request.method!==(action==='read'?'GET':'POST'))return reply({error:'method_not_allowed'},405);
 if(!env.DB)return reply({error:'catalog_storage_unavailable'},503);
 try{
  const variants=await catalog(env.DB),byKey=new Map(variants.map(v=>[v.key,v]));
  if(action==='read'){
   const size=u.searchParams.get('size')||'27.0',includeUnknown=u.searchParams.get('includeUnknown')!=='false';if(!/^\d{2}(?:\.0|\.5)?$/.test(size)||Number(size)<20||Number(size)>35)return reply({error:'invalid_size'},400);
   const key=u.searchParams.get('key');
   if(key){const v=byKey.get(key);if(!v)return reply({error:'unknown_variant'},404);const row=await env.DB.prepare('SELECT data_json FROM nike_catalog_state WHERE id=?').bind('nike-rakuten:'+v.styleCode.split('-')[0]).first();const data=row?JSON.parse(row.data_json):null;const allOffers=(data?.offers||[]).filter(o=>o.key===key),offers=filterOffersBySize(allOffers,size,includeUnknown);return reply({key,styleCode:v.styleCode,size:Number(size).toFixed(1),includeUnknown,source:MARKET_SOURCE,status:data?.lastError?'last_check_failed':data?'ok':'not_checked',checkedAt:data?.checkedAt||null,coverage:data?.coverage||null,offers,excludedOtherSizes:allOffers.filter(o=>o.listedSize&&Number(o.listedSize)!==Number(size)).length,...marketSummary(offers),sizeVerified:false,sizeNotice:'サイズ別在庫・価格は未確認です。商品名に単一のcmサイズがある場合は希望サイズに一致する出品を残し、サイズ不明は別扱いにします。'});}
   const rows=await env.DB.prepare("SELECT data_json FROM nike_catalog_state WHERE id LIKE 'nike-rakuten:%'").all();const summaries={},articles=new Set(variants.map(v=>v.styleCode.split('-')[0]));let checked=0,failed=0,lastCheckedAt=null;
   for(const row of rows.results||[]){const data=JSON.parse(row.data_json);if(!articles.has(data.article))continue;if(data.checkedAt)checked++;if(data.lastError)failed++;if(data.checkedAt&&(!lastCheckedAt||data.checkedAt>lastCheckedAt))lastCheckedAt=data.checkedAt;for(const v of variants.filter(v=>v.styleCode.startsWith(data.article+'-'))){const offers=filterOffersBySize(data.offers.filter(o=>o.key===v.key),size,includeUnknown);summaries[v.key]={...marketSummary(offers),checkedAt:data.checkedAt,limited:!data.coverage?.complete,failed:!!data.lastError};}}
   return reply({source:MARKET_SOURCE,articles:articles.size,checkedArticles:checked,failedArticles:failed,matchedVariants:Object.values(summaries).filter(v=>v.offerCount>0).length,lastCheckedAt,summaries,sizeVerified:false});
  }
  const body=await request.text();if(body.length>900000)return reply({error:'request_too_large'},413);let input;try{input=JSON.parse(body);}catch{return reply({error:'invalid_request'},400);}
  const article=input.article;if(!/^[A-Z]{2}\d{4}$/.test(article||'')||!variants.some(v=>v.styleCode.startsWith(article+'-')))return reply({error:'unknown_article'},400);
  const articleVariants=variants.filter(v=>v.styleCode.startsWith(article+'-'));
  if(action==='source'){
   if(!Number.isInteger(input.page)||input.page<1||input.page>MARKET_PAGE_LIMIT)return reply({error:'invalid_page'},400);
   if(!env.RAKUTEN_APPLICATION_ID||!env.RAKUTEN_ACCESS_KEY)return reply({error:'source_not_configured'},503);
   const url=new URL('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701');url.search=new URLSearchParams({applicationId:env.RAKUTEN_APPLICATION_ID,keyword:'NIKE '+article,NGKeyword:'中古',sort:'+itemPrice',availability:'1',hits:'30',page:String(input.page),format:'json'});
   const origin=env.RAKUTEN_ALLOWED_ORIGIN||'https://shoe-zap-27-prototype.ponpokoponnosuke.chatgpt.site';
   let r;try{r=await fetch(url,{headers:{accessKey:env.RAKUTEN_ACCESS_KEY,Origin:origin,Referer:origin+'/'},signal:AbortSignal.timeout(25000)});}catch{return reply({error:'source_unavailable'},502);}
   if(!r.ok)return reply({error:r.status===429?'source_rate_limited':'source_unavailable'},502);
   const j=await r.json(),items=(j.Items||[]).map(v=>v.Item||v);if(!Number.isInteger(j.count)||!Number.isInteger(j.pageCount)||!Array.isArray(j.Items))return reply({error:'invalid_source_response'},502);
   return reply({article,page:input.page,count:j.count,pageCount:j.pageCount,itemIds:items.map(v=>v.itemCode),offers:matchRakutenItems(items,articleVariants)});
  }
  const id='nike-rakuten:'+article,old=await env.DB.prepare('SELECT revision,sync_id,data_json FROM nike_catalog_state WHERE id=?').bind(id).first(),previous=old?JSON.parse(old.data_json):null;
  if(!/^[a-f0-9-]{36}$/.test(input.syncId||''))return reply({error:'invalid_sync_id'},400);if(old?.sync_id===input.syncId)return reply({status:'ok',replayed:true});
  const now=new Date().toISOString();let data;
  if(input.status==='failed'){data={...(previous||{article,offers:[],checkedAt:null,coverage:null}),lastError:'source_check_failed',attemptedAt:now};}
  else{
   if(!Number.isFinite(Date.parse(input.checkedAt))||Math.abs(Date.now()-Date.parse(input.checkedAt))>30*60*1000||previous?.checkedAt&&Date.parse(input.checkedAt)<Date.parse(previous.checkedAt)||!Array.isArray(input.offers)||input.offers.length>1500||!input.coverage||input.coverage.pages<1||input.coverage.pages>MARKET_PAGE_LIMIT||!Number.isInteger(input.coverage.count)||input.coverage.count<0||!Number.isInteger(input.coverage.fetchedItems)||input.coverage.fetchedItems<0||input.coverage.fetchedItems>150)return reply({error:'invalid_snapshot'},400);
   const seen=new Set();for(const o of input.offers){const v=byKey.get(o.key),dedup=o.key+'|'+o.id;if(!v||!v.styleCode.startsWith(article+'-')||v.styleCode!==o.styleCode||!Number.isSafeInteger(o.price)||o.price<1||!Number.isSafeInteger(o.priceMin)||o.priceMin<1||!Number.isSafeInteger(o.priceMax)||o.priceMax<o.priceMin||o.sizeVerified!==false||o.listedSize!==null&&(!/^(?:2\d|3[0-5])\.[05]$/.test(o.listedSize))||o.currency!=='JPY'||!/^[-a-z0-9_]+$/i.test(o.shopCode||'')||!merchantURL(o.url,o.shopCode)||!['title_style_code','description_product_code'].includes(o.matchBasis)||!['merchant_title','official_style_code'].includes(o.genderBasis)||typeof o.multipleStyles!=='boolean'||typeof o.title!=='string'||o.title.length>1000||typeof o.shop!=='string'||o.shop.length>200||typeof o.id!=='string'||o.id.length>200||seen.has(dedup))return reply({error:'invalid_offer'},400);seen.add(dedup);}
   data={article,checkedAt:input.checkedAt,offers:input.offers,coverage:{count:input.coverage.count,pages:input.coverage.pages,fetchedItems:input.coverage.fetchedItems,complete:input.coverage.fetchedItems===input.coverage.count},lastError:null,attemptedAt:now};
  }
  const rev=old?.revision||0;const result=await env.DB.prepare('INSERT INTO nike_catalog_state(id,revision,sync_id,updated_at,data_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,sync_id=excluded.sync_id,updated_at=excluded.updated_at,data_json=excluded.data_json WHERE nike_catalog_state.revision=?').bind(id,rev+1,input.syncId,now,JSON.stringify(data),rev).run();if(!result.meta.changes)return reply({error:'concurrent_update_retry'},409);
  return reply({status:input.status==='failed'?'failed':'ok',article,...marketSummary(data.offers)});
 }catch{return reply({error:'market_operation_failed'},500);}
}
