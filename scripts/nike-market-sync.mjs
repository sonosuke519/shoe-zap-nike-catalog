import {MARKET_PAGE_LIMIT} from '../server/nike-market.mjs';
const root='https://shoe-zap-27-prototype.ponpokoponnosuke.chatgpt.site',key=process.env.NIKE_SYNC_KEY;
if(!key)throw Error('Missing sync credentials');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let lastStart=0;
async function post(path,body){for(let n=0;n<3;n++){if(path.endsWith('shops-source')){await wait(Math.max(0,lastStart+1400-Date.now()));lastStart=Date.now();}const r=await fetch(root+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});let j;try{j=await r.json();}catch{throw Error('Invalid server response');}if(r.ok)return j;if(n<2&&r.status===502){await wait(5000*(n+1));continue;}const e=Error('Catalog operation failed');e.code=j.error||'server_error';throw e;}}
const r=await fetch(root+'/api/nike/catalog');if(!r.ok)throw Error('Catalog unavailable');const catalog=await r.json();
const articles=[...new Set(catalog.variants.filter(v=>!v.missingSince).map(v=>v.styleCode.split('-')[0]))];
// A bounded sample may be selected for local diagnosis; the scheduled workflow always scans all articles.
const requested=process.argv.find(v=>v.startsWith('--articles='))?.split('=')[1].split(',');if(requested?.some(v=>!articles.includes(v)))throw Error('Unknown article');
let failures=0,totalOffers=0,done=0;
for(const article of requested||articles){
 const syncId=crypto.randomUUID();
 try{
  let count=0,pages=1,fetched=0;const ids=new Set(),offers=new Map();
  for(let page=1;page<=pages;page++){
   const j=await post('/api/nike/shops-source',{article,page});if(page===1){count=j.count;pages=Math.max(1,Math.min(MARKET_PAGE_LIMIT,j.pageCount));}else if(j.count!==count)throw Error('Source changed during pagination');
   if(j.itemIds.some(id=>ids.has(id)))throw Error('Duplicate source page');for(const id of j.itemIds)ids.add(id);fetched+=j.itemIds.length;for(const o of j.offers)offers.set(o.key+'|'+o.id,o);
   if(j.itemIds.length!==Math.min(30,Math.max(0,count-(page-1)*30)))throw Error('Incomplete source page');
  }
  const result=await post('/api/nike/shops-sync',{syncId,article,status:'ok',checkedAt:new Date().toISOString(),coverage:{count,pages,fetchedItems:fetched},offers:[...offers.values()]});totalOffers+=result.offerCount;done++;console.log(JSON.stringify({article,status:'ok',candidateOffers:result.offerCount,shops:result.shops,fetchedItems:fetched,totalResults:count,limited:fetched<count}));
 }catch(error){failures++;try{await post('/api/nike/shops-sync',{syncId,article,status:'failed'});}catch{}console.error(JSON.stringify({article,status:'failed',error:error.code||'collection_failed'}));}
}
console.log(JSON.stringify({status:failures?'partial_failure':'ok',articles:done,failures,candidateOffers:totalOffers}));if(failures)process.exitCode=1;
