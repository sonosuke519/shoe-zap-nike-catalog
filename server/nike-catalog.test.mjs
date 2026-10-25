import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNike,NIKE_SOURCES,normalizeGroupings,validateSnapshot,reconcileNike} from './nike-catalog.mjs';
import {nikeEndpoint} from './nike-endpoints.mjs';
const date='2026-10-25T12:00:00.000Z';
function product(code='AB1234-001',title='ナイキ テスト 1') {return {productType:'FOOTWEAR',productSubType:'STANDARD',productCode:code,copy:{title,subTitle:'メンズ ロードランニングシューズ'},pdpUrl:{url:'https://www.nike.com/jp/t/test/'+code},colorwayImages:{squarishURL:'https://static.nike.com/a/images/test/'+code+'.jpg'},prices:{currency:'JPY',currentPrice:17000,employeePrice:1},displayColors:{colorDescription:'ブラック/ホワイト',simpleColor:{label:'ブラック'}},featuredAttributes:[]};}
const group=p=>({products:[p]});
function snapshot(products=[product()]){const variants=NIKE_SOURCES.flatMap(s=>normalizeGroupings(products.map(group),s.audience));return {version:1,status:'ok',syncId:crypto.randomUUID(),collectedAt:date,variants,coverage:NIKE_SOURCES.map(s=>({...s,pages:1,expectedGroups:products.length,observedGroups:products.length,variants:products.length,complete:true}))};}
test('fresh listing discovers a new URL on the next page for both audiences',async()=>{
 const calls=[];const result=await collectNike({clock:()=>new Date(date),wait:async()=>{},fetcher:async(url,options)=>{
  calls.push({url,options});const next=url.startsWith('https://api.nike.com');const source=NIKE_SOURCES.find(s=>next?new URL(url).searchParams.get('path')===new URL(s.url).pathname:url===s.url);assert.ok(source);
  const pages={totalResources:2,next:next?'':`/discover/product_wall/v1/marketplace/JP/language/ja/test?path=${new URL(source.url).pathname}&anchor=24`};const productGroupings=[group(product(next?'NEW999-200':'AB1234-001',next?'ナイキ 新モデル 2':'ナイキ テスト 1'))];
  return new Response(next?JSON.stringify({productGroupings,pages}):`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{initialState:{Wall:{productGroupings,pageData:pages}}}}})}</script>`);
 }});assert.equal(calls.length,4);assert.equal(result.variants.length,4);assert.ok(result.variants.some(r=>r.url.endsWith('NEW999-200')));assert.ok(calls[1].options.headers['nike-api-caller-id']);assert.equal(JSON.stringify(result).includes('employeePrice'),false);validateSnapshot(result,new Date(date));
});
test('customized By You products are excluded without breaking the crawl',()=>{assert.deepEqual(normalizeGroupings([group({...product(),productSubType:'CUSTOMIZED',productCode:'1234567890'})],'men'),[]);});
test('incomplete pagination, redirects to other hosts and source failures stop collection',async()=>{
 for(const mode of ['incomplete','host','failure'])await assert.rejects(()=>collectNike({wait:async()=>{},sources:[NIKE_SOURCES[0]],fetcher:async()=> mode==='failure'?new Response('',{status:429}):new Response(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{initialState:{Wall:{productGroupings:[group(product())],pageData:{totalResources:2,next:mode==='host'?'https://evil.example/steal':''}}}}}})}</script>`)}),e=>['incomplete_listing','invalid_next_page','source_rate_limited'].includes(e.code));
});
test('baseline is not mislabeled as newly launched shoes',()=>{const r=reconcileNike([],snapshot(),{baseline:true});assert.equal(r.changes.length,0);assert.equal(r.summary.models,2);assert.equal(r.summary.baseline,true);});
test('detects model additions, new colors, price changes, disappearance and return',()=>{
 const baseline=reconcileNike([],snapshot(),{baseline:true});const added=snapshot([product(),product('AB1234-200'),product('NEW999-001','ナイキ 新モデル 2')]);added.variants[0].price=18000;
 const second=reconcileNike(baseline.variants,added);assert.equal(second.summary.modelAdded,2);assert.equal(second.summary.colorAdded,2);assert.equal(second.summary.changed,1);
 const third=reconcileNike(second.variants,snapshot());assert.equal(third.summary.notSeen,4);assert.equal(third.variants.length,6);assert.ok(third.variants.find(r=>r.styleCode==='NEW999-001').missingSince);
 const repeat=reconcileNike(third.variants,snapshot());assert.equal(repeat.summary.notSeen,0);
 const returned=reconcileNike(third.variants,added);assert.equal(returned.summary.returned,4);assert.equal(returned.summary.modelAdded,0);
});
test('a sudden large drop cannot remove the previous catalog',()=>{const many=snapshot(Array.from({length:12},(_,i)=>product('AB'+String(i).padStart(4,'0')+'-001')));const before=reconcileNike([],many,{baseline:true});assert.throws(()=>reconcileNike(before.variants,snapshot()),{code:'suspicious_catalog_drop'});});
test('reject stale, incomplete and malicious snapshots',()=>{
 const stale=snapshot();assert.throws(()=>validateSnapshot(stale,new Date(Date.parse(date)+31*60_000)),{code:'stale_snapshot'});
 for(const change of [s=>s.coverage.pop(),s=>s.variants[0].url='https://evil.example/',s=>s.variants[0].sizeVerified=true,s=>s.variants[0].modelKey='men:wrong:regular',s=>s.variants[0].listingStatus='available_in_27cm']){const s=snapshot();change(s);assert.throws(()=>validateSnapshot(s,new Date(date)));}
});
test('write endpoint requires a secret; public endpoint cannot write',async()=>{
 assert.equal((await nikeEndpoint(new Request('https://site/api/nike/sync',{method:'POST',body:'{}'}),{NIKE_SYNC_KEY:'x'.repeat(40)})).status,401);
 assert.equal((await nikeEndpoint(new Request('https://site/api/nike/catalog',{method:'POST'}),{})).status,405);
 assert.equal(await nikeEndpoint(new Request('https://site/api/unrelated'),{}),null);
});
