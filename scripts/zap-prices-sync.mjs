// Uses the existing updater key; shopping API credentials stay on the Site.
const root='https://shoe-zap-27-prototype.ponpokoponnosuke.chatgpt.site',key=process.env.NIKE_SYNC_KEY;
if(!key)throw Error('Missing updater key');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export async function refreshPrices({fetcher=fetch,limit=0}={}){
 const r=await fetcher(root+'/api/zap/catalog');if(!r.ok)throw Error('Catalog unavailable');const catalog=await r.json();
 // Active listings first so the ordinary zapping view becomes ready sooner.
 const cards=[...catalog.cards].sort((a,b)=>Number(b.listingCheck?.status==='available')-Number(a.listingCheck?.status==='available'));
 const all=[...new Set(cards.map(c=>c.modelKey))],models=limit?all.slice(0,limit):all;let completed=0,failed=0;
 for(const modelKey of models){let saved=false;for(let attempt=0;attempt<3;attempt++){
  try{const response=await fetcher(root+'/api/zap/reference-price/refresh',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({modelKey}),signal:AbortSignal.timeout(240000)});if(response.ok){const j=await response.json();if(j.modelKey===modelKey&&['ok','not_found'].includes(j.status)){saved=true;break;}}if(response.status===401||response.status===403)throw Error('Updater authorization failed');}catch(e){if(e.message==='Updater authorization failed')throw e;}
  await wait((attempt+1)*5000);
 }if(saved)completed++;else failed++;console.log(JSON.stringify({modelKey,completed,total:models.length,status:saved?'saved':'failed'}));}
 console.log(JSON.stringify({complete:true,completed,failed,total:models.length}));if(failed)process.exitCode=1;
}
const limit=Number(process.env.ZAP_MODEL_LIMIT||0);if(!Number.isInteger(limit)||limit<0||limit>1000)throw Error('Invalid diagnostic limit');await refreshPrices({limit});
