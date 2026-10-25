import fs from 'node:fs/promises';
import {collectAdidas} from '../server/adidas-catalog.mjs';
const args=process.argv.slice(2),root=process.env.CATALOG_SITE_ROOT||'https://shoe-zap-27-prototype.ponpokoponnosuke.chatgpt.site',key=process.env.NIKE_SYNC_KEY;
if(root!=='https://shoe-zap-27-prototype.ponpokoponnosuke.chatgpt.site')throw Error('Invalid destination');
async function post(path,body){for(let attempt=0;attempt<3;attempt++){const r=await fetch(root+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const j=await r.json();if(r.ok)return j;if(attempt<2&&r.status===502&&['source_unavailable','source_rate_limited'].includes(j.error)){await new Promise(resolve=>setTimeout(resolve,4000*(attempt+1)));continue;}const e=Error('Catalog operation failed');e.code=j.error||'sync_rejected';throw e;}}
try{
 if(!key)throw Error('Missing sync credentials');
 const snapshot=await collectAdidas({fetchPage:page=>post('/api/adidas/source-page',{page})});
 const output=args.indexOf('--output');if(output>=0)await fs.writeFile(args[output+1],JSON.stringify(snapshot));
 console.log(JSON.stringify(await post('/api/adidas/sync',snapshot)));
}catch(error){const code=error.code||'collector_failed';if(key)try{await post('/api/adidas/sync',{status:'failed',syncId:crypto.randomUUID(),errorCode:code});}catch{}console.error(JSON.stringify({status:'failed',error:code}));process.exitCode=1;}
