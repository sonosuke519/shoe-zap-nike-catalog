import fs from 'node:fs/promises';
import {collectNike} from '../server/nike-catalog.mjs';
const args=process.argv.slice(2);
let config={url:process.env.NIKE_SYNC_URL,key:process.env.NIKE_SYNC_KEY};
if(args.includes('--private-stdin')){
 process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdout.write('Ready for private sync configuration (input is hidden).\n');
 config=await new Promise((resolve,reject)=>{let value='';const receive=chunk=>{value+=chunk;if(!/[\r\n]/.test(value))return;process.stdin.off('data',receive);process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(value.trim()));}catch{reject(Error('Invalid configuration'));}};process.stdin.on('data',receive);process.stdin.resume();});
}
async function send(snapshot){
 const url=new URL(config.url);if(url.protocol!=='https:'||url.hostname!=='shoe-zap-27-prototype.ponpokoponnosuke.chatgpt.site'||url.pathname!=='/api/nike/sync')throw Error('Invalid sync destination');
 const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+config.key,'content-type':'application/json'},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(60000)});
 const result=await response.json();if(!response.ok)throw Error('Sync rejected: '+(result.error||response.status));return result;
}
try{
 const snapshot=await collectNike();
 const output=args.indexOf('--output');if(output>=0)await fs.writeFile(args[output+1],JSON.stringify(snapshot));
 if(args.includes('--upload')||args.includes('--private-stdin')){if(!config.key)throw Error('Missing sync credentials');console.log(JSON.stringify(await send(snapshot)));}
 else console.log(JSON.stringify({collectedAt:snapshot.collectedAt,coverage:snapshot.coverage,variants:snapshot.variants.length,models:new Set(snapshot.variants.map(r=>r.modelKey)).size}));
}catch(error){
 const code=error.code||'collector_failed';
 if(config.key&&config.url)try{await send({version:1,status:'failed',syncId:crypto.randomUUID(),collectedAt:new Date().toISOString(),errorCode:code});}catch{}
 console.error(JSON.stringify({status:'failed',error:code}));process.exitCode=1;
}
