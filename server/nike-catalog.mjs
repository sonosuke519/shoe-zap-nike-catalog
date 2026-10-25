// Deterministic public catalog reader. No AI, account, cookie or private Nike API.
export const NIKE_SOURCES=[
 {audience:'men',url:'https://www.nike.com/jp/w/mens-running-shoes-37v7jznik1zy7ok'},
 {audience:'women',url:'https://www.nike.com/jp/w/womens-running-shoes-37v7jz5e1x6zy7ok'}
];
const UA='ShoeZapCatalog/0.1 (+https://shoe-zap-27-prototype.ponpokoponnosuke.chatgpt.site)';
export class CatalogError extends Error{constructor(code){super(code);this.code=code;}}
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const modelTitle=value=>clean(value).replace(/^Nike\s+/i,'ナイキ ');
const fail=code=>{throw new CatalogError(code);};
function officialURL(value,kind){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;if(kind==='product')return u.hostname==='www.nike.com'&&u.pathname.startsWith('/jp/t/')?u.href:null;return u.hostname==='static.nike.com'&&u.pathname.startsWith('/a/images/')?u.href:null;}catch{return null;}}
export function extractWall(html){
 const scripts=[...String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
 const script=scripts.find(m=>/\bid\s*=\s*["']__NEXT_DATA__["']/i.test(m[1]));if(!script)fail('listing_structure_changed');
 let data;try{data=JSON.parse(script[2]);}catch{fail('listing_json_invalid');}
 const wall=data?.props?.pageProps?.initialState?.Wall;if(!Array.isArray(wall?.productGroupings)||!wall.pageData)fail('listing_structure_changed');return wall;
}
export function normalizeGroupings(groupings,audience){
 if(!['men','women'].includes(audience)||!Array.isArray(groupings))fail('invalid_catalog');
 return groupings.flatMap(g=>(g.products??[]).flatMap(p=>{
  if(p.productType!=='FOOTWEAR'||['CUSTOM','CUSTOMIZED'].includes(p.productSubType))return [];
  const title=modelTitle(p.copy?.title),subtitle=clean(p.copy?.subTitle),styleCode=clean(p.productCode);
  const url=officialURL(p.pdpUrl?.url||('https://www.nike.com'+p.pdpUrl?.path),'product');
  const image=officialURL(p.colorwayImages?.squarishURL||p.colorwayImages?.portraitURL,'image');
  const price=Number(p.prices?.currentPrice);
  if(!title||!subtitle||!/^[-A-Z0-9]{4,25}-[A-Z0-9]{3}$/.test(styleCode)||!url||!image||p.prices?.currency!=='JPY'||!Number.isSafeInteger(price)||price<=0)fail('product_structure_changed');
  if(!/ランニング|レーシング|ロードレース|トラック|スパイク/.test(subtitle))return [];
  const gender=/ウィメンズ|レディース/.test(subtitle)?'women':/メンズ/.test(subtitle)?'men':'unisex';
  const width=/ワイド/.test(subtitle)?'wide':'regular';
  const category=/トレイル/.test(subtitle)?'trail':/トラック|スパイク/.test(subtitle)?'track':/レーシング|ロードレース/.test(subtitle)?'race':'road';
  const flags=p.featuredAttributes??[];
  return [{key:`${audience}:${styleCode}`,modelKey:`${audience}:${title}:${width}`,title,subtitle,audience,gender,width,category,styleCode,colorCode:styleCode.split('-').at(-1),colorName:clean(p.displayColors?.colorDescription),simpleColor:clean(p.displayColors?.simpleColor?.label),price,currency:'JPY',url,image,listingStatus:flags.includes('OUT_OF_STOCK')?'out_of_stock':flags.some(f=>/COMING_SOON/.test(f))?'coming_soon':'listed',sizeVerified:false}];
 }));
}
function nextPageURL(path,source){
 let u;try{u=new URL(path,'https://api.nike.com');}catch{fail('invalid_next_page');}
 if(u.protocol!=='https:'||u.hostname!=='api.nike.com'||u.username||u.password||!u.pathname.startsWith('/discover/product_wall/v1/marketplace/JP/language/ja/')||u.searchParams.get('path')!==new URL(source.url).pathname)fail('invalid_next_page');return u.href;
}
async function readResponse(fetcher,url,json=false){
 const response=await fetcher(url,{headers:{'user-agent':UA,...(json?{'nike-api-caller-id':'shoe-zap:catalog:0.1'}:{})},redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!response.ok)fail(response.status===429?'source_rate_limited':response.status===401||response.status===403?'source_access_denied':'source_unavailable');
 const text=await response.text();if(text.length>4_000_000)fail('source_too_large');if(!json)return text;
 try{return JSON.parse(text);}catch{fail('listing_json_invalid');}
}
export async function collectNike({fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>new Date(),sources=NIKE_SOURCES}={}){
 const rows=new Map(),coverage=[];
 for(const source of sources){
  const wall=extractWall(await readResponse(fetcher,source.url));
  let groups=wall.productGroupings,pages=wall.pageData,pageCount=0,productGroups=0;const visited=new Set();const expected=Number(pages.totalResources);
  if(!Number.isInteger(expected)||expected<1||expected>5000)fail('invalid_source_count');
  while(true){
   pageCount++;productGroups+=groups.filter(g=>g.products?.length).length;
   for(const row of normalizeGroupings(groups,source.audience))rows.set(row.key,row);
   if(!pages.next)break;if(pageCount>=30)fail('page_limit_reached');
   const next=nextPageURL(pages.next,source);if(visited.has(next))fail('pagination_loop');visited.add(next);
   await wait(1500);const page=await readResponse(fetcher,next,true);
   if(!Array.isArray(page.productGroupings)||!page.pages)fail('listing_structure_changed');groups=page.productGroupings;pages=page.pages;
  }
  // A partial page must never mark unseen models as removed.
  if(productGroups<expected)fail('incomplete_listing');
  const count=[...rows.values()].filter(r=>r.audience===source.audience).length;if(!count)fail('empty_listing');
  coverage.push({audience:source.audience,url:source.url,pages:pageCount,expectedGroups:expected,observedGroups:productGroups,variants:count,complete:true});await wait(1500);
 }
 return {version:1,status:'ok',syncId:crypto.randomUUID(),collectedAt:clock().toISOString(),coverage,variants:[...rows.values()]};
}
const tracked=['modelKey','title','subtitle','colorName','simpleColor','price','url','image','listingStatus','width','category'];
export function validateSnapshot(input,now=new Date()){
 if(input?.version!==1||input.status!=='ok'||!/^[a-z0-9-]{16,80}$/i.test(input.syncId??'')||!Array.isArray(input.variants)||input.variants.length<1||input.variants.length>2000)fail('invalid_snapshot');
 const at=Date.parse(input.collectedAt);if(!Number.isFinite(at)||Math.abs(now.getTime()-at)>30*60_000)fail('stale_snapshot');
 if(!Array.isArray(input.coverage)||input.coverage.length!==2||NIKE_SOURCES.some(source=>!input.coverage.some(c=>c.audience===source.audience&&c.url===source.url&&c.complete===true&&Number.isInteger(c.pages)&&c.pages>=1&&c.pages<=30&&Number.isInteger(c.observedGroups)&&c.observedGroups>=c.expectedGroups&&Number.isInteger(c.expectedGroups)&&c.expectedGroups>=1)))fail('incomplete_listing');
 const keys=new Set();
 for(const r of input.variants){
  if(!['men','women'].includes(r.audience)||r.key!==`${r.audience}:${r.styleCode}`||keys.has(r.key)||!r.title||r.title.length>200||!['regular','wide'].includes(r.width)||r.modelKey!==`${r.audience}:${r.title}:${r.width}`||!['men','women','unisex'].includes(r.gender)||!['road','race','trail','track'].includes(r.category)||!['listed','out_of_stock','coming_soon'].includes(r.listingStatus)||!/^[-A-Z0-9]{4,25}-[A-Z0-9]{3}$/.test(r.styleCode)||!officialURL(r.url,'product')||!officialURL(r.image,'image')||!Number.isSafeInteger(r.price)||r.price<=0||r.currency!=='JPY'||r.sizeVerified!==false)fail('invalid_snapshot');keys.add(r.key);
 }
 for(const c of input.coverage)if(c.variants!==input.variants.filter(r=>r.audience===c.audience).length)fail('incomplete_listing');
 return input;
}
export function reconcileNike(previous,snapshot,{baseline=false}={}){
 const now=snapshot.collectedAt,old=new Map(previous.map(r=>[r.key,r])),incoming=new Map(snapshot.variants.map(r=>[r.key,r]));
 for(const audience of ['men','women']){const before=previous.filter(r=>r.audience===audience&&!r.missingSince).length;const after=snapshot.variants.filter(r=>r.audience===audience).length;if(before>=10&&after<before*.6)fail('suspicious_catalog_drop');}
 const existingModels=new Set(previous.map(r=>r.modelKey)),newModels=new Set(),changes=[],rows=[];
 for(const row of incoming.values()){
  const prior=old.get(row.key);rows.push({...row,firstSeen:prior?.firstSeen||now,lastSeen:now,missingSince:null,missingRuns:0});
  if(!prior){if(!baseline){if(!existingModels.has(row.modelKey)){if(!newModels.has(row.modelKey)){changes.push({kind:'model_added',key:row.key,title:row.title,styleCode:row.styleCode});newModels.add(row.modelKey);}}else changes.push({kind:'color_added',key:row.key,title:row.title,styleCode:row.styleCode,colorName:row.colorName});}}
  else {if(prior.missingSince)changes.push({kind:'returned',key:row.key,title:row.title,styleCode:row.styleCode});const fields=tracked.filter(k=>prior[k]!==row[k]);if(fields.length)changes.push({kind:'changed',key:row.key,title:row.title,styleCode:row.styleCode,fields});}
 }
 for(const prior of old.values())if(!incoming.has(prior.key)){rows.push({...prior,missingSince:prior.missingSince||now,missingRuns:(prior.missingRuns||0)+1});if(!prior.missingSince)changes.push({kind:'not_seen',key:prior.key,title:prior.title,styleCode:prior.styleCode});}
 const active=rows.filter(r=>!r.missingSince);
 return {variants:rows,changes,summary:{baseline,models:new Set(active.map(r=>r.modelKey)).size,variants:active.length,modelAdded:changes.filter(c=>c.kind==='model_added').length,colorAdded:changes.filter(c=>c.kind==='color_added').length,changed:changes.filter(c=>c.kind==='changed').length,notSeen:changes.filter(c=>c.kind==='not_seen').length,returned:changes.filter(c=>c.kind==='returned').length}};
}
