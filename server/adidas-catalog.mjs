import {CatalogError} from './nike-catalog.mjs';
export const ADIDAS_SOURCE={shop:'adidas',url:'https://www.rakuten.co.jp/adidas/',label:'アディダス公式楽天店',keyword:'ランニング シューズ'};
const clean=v=>String(v??'').normalize('NFKC').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const fail=code=>{throw new CatalogError(code);};
function safeURL(value,image=false){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;return image?(['thumbnail.image.rakuten.co.jp','image.rakuten.co.jp'].includes(u.hostname)&&u.pathname.includes('/adidas/')?u.href:null):(u.hostname==='item.rakuten.co.jp'&&u.pathname.startsWith('/adidas/')?u.href:null);}catch{return null;}}
const colorMap={黒:'ブラック',白:'ホワイト',青:'ブルー',赤:'レッド',緑:'グリーン',灰色:'グレー',黄色:'イエロー',茶色:'ブラウン',紫:'パープル',黒色:'ブラック',白色:'ホワイト'};
export function adidasModelName(title){const t=clean(title),name=t.includes('/')?t.slice(t.indexOf('/')+1):t;return name.toUpperCase().replace(/\b(RUNNING|SHOES|WIDE)\b/g,'').replace(/ランニングシューズ|ランニング|ワイド/g,'').replace(/[^\p{L}\p{N}]/gu,'');}
export function normalizeAdidasItem(p){
 if(p.shopCode!=='adidas')fail('unexpected_shop');
 const name=clean(p.itemName),caption=clean(p.itemCaption),sports=caption.match(/Sports:([^]*?)Category:/)?.[1]||caption.match(/スポーツ:([^]*?)(?:テクノロジー:|$)/)?.[1]||'';
 if(!/ランニング/.test(sports)||!/Category:シューズ・靴/.test(caption)||/キッズ|子供|ジュニア|リトルキッズ/.test(name)||/Brand:スポーツウェア/.test(caption))return [];
 const styleCode=caption.match(/商品番号:\s*([A-Z0-9]{6,10})\b/)?.[1],modelCode=caption.match(/モデル:\s*([A-Z0-9]{4,12})\b/)?.[1],colorName=clean(caption.match(/色:\s*([^]*?)(?=モデル:)/)?.[1]);
 const title=clean(name.replace(/【[^】]*】/g,' ').match(/(?:トレイルランニング|ランニングシューズ|ランニング|アウトドア|モータースポーツ)\s+(.+?)\s+(?:パフォーマンス|アディダス\s*(?:テレックス|バイ\s*ステラマッカートニー)|スポーツウェア)/)?.[1]);
 const gender=/ユニセックス/.test(name)?'unisex':/レディース|ウィメンズ/.test(name)?'women':/メンズ/.test(name)?'men':null;
 // API titles may be truncated before the gender. Do not invent it from sizes.
 if(!gender)return [];
 const url=safeURL(p.itemUrl),image=safeURL(p.mediumImageUrls?.[0]?.imageUrl,true),price=Number(p.itemPrice);
 if(!title||!styleCode||!modelCode||!colorName||!gender||!url||!image||!Number.isSafeInteger(price)||price<=0||p.taxFlag!==0||!new URL(url).pathname.toUpperCase().includes('/'+styleCode+'/'))fail('adidas_product_structure_changed');
 const width=/ワイド|\bwide\b/i.test(title)?'wide':'regular';
 // Usage labels are limited to explicit words in the product title.
 const category=/トレイル|テレックス|TERREX/i.test(title)?'trail':/スパイク|陸上|中距離|長距離用|DISTANCESTAR|ADIZERO AMBITION/i.test(title)?'track':'road';
 const simple=clean(caption.match(/【color:([^】]+)】/)?.[1]);
 return (gender==='unisex'?['men','women']:[gender]).map(audience=>({brand:'adidas',key:`${audience}:${styleCode}`,modelKey:`${audience}:${adidasModelName(title)}:${width}`,modelCode,title,subtitle:(gender==='unisex'?'ユニセックス':gender==='men'?'メンズ':'レディース')+' ランニングシューズ',audience,gender,width,category,styleCode,colorCode:styleCode,colorName,simpleColor:colorMap[simple]||simple,price,currency:'JPY',url,image,listingStatus:p.availability===1?'listed':'out_of_stock',sizeVerified:false,source:'adidas_official_rakuten'}));
}
export function normalizeAdidasItems(items){const map=new Map();for(const p of items)for(const r of normalizeAdidasItem(p)){const old=map.get(r.key);if(!old||r.price<old.price)map.set(r.key,r);}return [...map.values()];}
export async function collectAdidas({fetchPage,wait=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>new Date()}={}){
 if(!fetchPage)fail('source_not_configured');const all=new Map();let expected=0,pages=1;
 for(let page=1;page<=pages;page++){
  const j=await fetchPage(page);if(!Array.isArray(j.items)||j.page!==page)fail('adidas_source_structure_changed');
  if(page===1){expected=j.count;pages=j.pageCount;if(!Number.isInteger(expected)||expected<1||expected>3000||!Number.isInteger(pages)||pages<1||pages>100)fail('source_pagination_capacity');}
  if(j.count!==expected||j.pageCount!==pages)fail('source_changed_during_collection');
  for(const p of j.items)all.set(p.itemCode,p);if(page<pages)await wait(1400);
 }
 if(all.size!==expected)fail('incomplete_listing');const variants=normalizeAdidasItems([...all.values()]);if(!variants.length)fail('empty_listing');
 return {version:1,status:'ok',brand:'adidas',syncId:crypto.randomUUID(),collectedAt:clock().toISOString(),coverage:[{source:'adidas_official_rakuten',url:ADIDAS_SOURCE.url,keyword:ADIDAS_SOURCE.keyword,pages,expectedItems:expected,observedItems:all.size,variants:variants.length,complete:true}],variants};
}
export function validateAdidasSnapshot(input,now=new Date()){
 if(input?.version!==1||input.status!=='ok'||input.brand!=='adidas'||!/^[a-z0-9-]{16,80}$/i.test(input.syncId??'')||!Array.isArray(input.variants)||input.variants.length<1||input.variants.length>2000)fail('invalid_snapshot');
 const at=Date.parse(input.collectedAt);if(!Number.isFinite(at)||Math.abs(now.getTime()-at)>30*60_000)fail('stale_snapshot');
 const c=input.coverage?.[0];if(input.coverage?.length!==1||c?.source!=='adidas_official_rakuten'||c.url!==ADIDAS_SOURCE.url||c.complete!==true||c.keyword!==ADIDAS_SOURCE.keyword||!Number.isInteger(c.pages)||c.pages<1||c.pages>100||!Number.isInteger(c.expectedItems)||c.expectedItems<1||c.observedItems!==c.expectedItems||c.variants!==input.variants.length)fail('incomplete_listing');
 const keys=new Set();for(const r of input.variants){if(r.brand!=='adidas'||r.source!=='adidas_official_rakuten'||!['men','women'].includes(r.audience)||!['men','women','unisex'].includes(r.gender)||(r.gender!=='unisex'&&r.gender!==r.audience)||!['regular','wide'].includes(r.width)||!['road','race','trail','track'].includes(r.category)||!['listed','out_of_stock'].includes(r.listingStatus)||!r.title||r.title.length>200||!/^[A-Z0-9]{6,10}$/.test(r.styleCode)||!/^[A-Z0-9]{4,12}$/.test(r.modelCode)||r.key!==`${r.audience}:${r.styleCode}`||r.modelKey!==`${r.audience}:${adidasModelName(r.title)}:${r.width}`||keys.has(r.key)||!safeURL(r.url)||!safeURL(r.image,true)||!Number.isSafeInteger(r.price)||r.price<=0||r.currency!=='JPY'||r.sizeVerified!==false)fail('invalid_snapshot');keys.add(r.key);}return input;
}
