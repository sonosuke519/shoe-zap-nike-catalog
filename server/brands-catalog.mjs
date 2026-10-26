export const BRANDS={
 newbalance:{label:'New Balance',host:'shop.newbalance.jp',source:'official_rakuten',shop:'newbalance-store'},
 brooks:{label:'Brooks',host:'brooksrunning.co.jp',source:'official_site',collections:['men-road-running','women-road-running','men-racing','women-racing','men-trail','women-trail']},
 saucony:{label:'Saucony',host:'saucony.jp',source:'official_site',collections:['running-mens','running-womens','racing-mens','racing-womens','trail-mens','trail-womens']},
 salomon:{label:'Salomon',host:'salomon.jp',source:'official_site',collections:['men-shoes-running','women-shoes-running','men-shoes-trail-running','women-shoes-trail-running','men-shoes-gravel-running','women-shoes-gravel-running']},
 asics:{label:'ASICS',host:'www.asics.com',shop:'asicsonline',source:'official_rakuten'},
 mizuno:{label:'Mizuno',host:'jpn.mizuno.com',shop:'mizunoshop',source:'official_rakuten'},
 puma:{label:'PUMA',host:'jp.puma.com',shop:'puma',source:'official_rakuten'}
};
export const clean=v=>String(v??'').normalize('NFKC').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
export const decode=v=>String(v).replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const fail=code=>{const e=Error(code);e.code=code;throw e;};
export function safeBrandURL(value,brand,image=false){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;const b=BRANDS[brand];if(!b)return null;if(image)return ['cdn.shopify.com','nb.scene7.com','image.rakuten.co.jp','thumbnail.image.rakuten.co.jp'].includes(u.hostname)?u.href:null;return u.hostname===b.host||u.hostname==='item.rakuten.co.jp'&&b.shop&&u.pathname.startsWith('/'+b.shop+'/')?u.href:null;}catch{return null;}}
export function modelName(t){return clean(t).split(/\s*\|\s*/)[0].replace(/\s*\([^)]*\)\s*/g,' ').replace(/\s+/g,' ').trim();}
export const modelId=t=>modelName(t).toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
function makeRows(brand,{title,styleCode,colorName,image,url,gender,category='road',price,listingStatus='listed',width='unknown',matchCodes=[]}){
 const b=BRANDS[brand];title=modelName(title);styleCode=clean(styleCode).toUpperCase();price=Number(price);
 if(!title||!styleCode||!safeBrandURL(url,brand)||!safeBrandURL(image,brand,true)||!Number.isSafeInteger(price)||price<1||!['men','women','unisex'].includes(gender))fail('product_structure_changed');
 return (gender==='unisex'?['men','women']:[gender]).map(audience=>({brand,source:b.source,key:`${audience}:${styleCode}`,modelKey:`${audience}:${modelId(title)}:${width}`,title,subtitle:(gender==='men'?'メンズ':gender==='women'?'ウィメンズ':'ユニセックス')+' ランニングシューズ',audience,gender,category,width,styleCode,colorCode:styleCode,colorName:clean(colorName),image,url,price,currency:'JPY',listingStatus,sizeVerified:false,matchCodes:[...new Set([styleCode,...matchCodes])]}));
}
export function normalizeShopify(brand,products,collection){
 const b=BRANDS[brand],audience=/women/.test(collection)?'women':'men',category=/trail/.test(collection)?'trail':/racing/.test(collection)?'race':'road';const rows=[];let excluded=0;
 for(const p of products){
  const tags=Array.isArray(p.tags)?p.tags:[],text=tags.join(' ');
  if(brand==='saucony'&&!tags.includes('シューズ')||brand==='brooks'&&!tags.includes('SHOES')&&!tags.includes('MENSHOES')&&!tags.includes('WOMENSHOES')||brand==='salomon'&&!/シューズ/.test(text)){excluded++;continue;}
  const colorIndex=p.options.findIndex(o=>/色|カラー|color/i.test(o.name)),groups=new Map();if(colorIndex<0)fail('color_structure_changed');
  for(const v of p.variants){const color=v['option'+(colorIndex+1)];if(!groups.has(color))groups.set(color,[]);groups.get(color).push(v);}
  for(const [color,variants] of groups){
   const first=variants[0],image=first.featured_image?.src||p.images.find(i=>i.variant_ids?.includes(first.id))?.src||p.images[0]?.src;
   let styleCode,matchCodes=[];
   if(brand==='brooks'){styleCode=first.sku?.replace(/-\d{3}$/, '');const international=image?.match(/\/(\d{6})_(\d{3})_/);if(international)matchCodes.push(international[1]+'-'+international[2]);}
   else if(brand==='saucony'){styleCode=image?.match(/\/(S\d{5,6}-\d{2,4})[A-Z]?(?:_|\.)/i)?.[1]?.toUpperCase();if(styleCode&&!tags.some(t=>t.toUpperCase()===styleCode)){const candidates=tags.filter(t=>/^S\d{5,6}-\d{2,4}$/i.test(t)&&t.split('-')[1]===styleCode.split('-')[1]);if(candidates.length===1)styleCode=candidates[0].toUpperCase();}if(!styleCode||!tags.some(t=>t.toUpperCase()===styleCode))fail('saucony_color_code_missing');}
   else if(brand==='salomon'){styleCode=first.sku?.match(/^L\d{8}/)?.[0];}
   const gender=brand==='salomon'&&tags.includes('ユニセックス')?'unisex':audience;
   if(brand==='brooks'&&/WOMEN/.test(p.product_type)&&audience!=='women'||brand==='brooks'&&p.product_type==='MEN'&&audience!=='men')continue;
   const stocked=variants.filter(v=>v.available),price=Math.min(...(stocked.length?stocked:variants).map(v=>Number(v.price)));
   rows.push(...makeRows(brand,{title:p.title,styleCode,colorName:color,image,url:`https://${b.host}/products/${encodeURIComponent(p.handle)}`,gender,category,price,listingStatus:stocked.length?'listed':'out_of_stock',width:/ワイド|\bwide\b/i.test(p.title)?'wide':'unknown',matchCodes}));
  }
 }
 return {rows,excluded};
}
export function parseNewBalance(html,audience){
 const matches=[...html.matchAll(/<span\s+data-tealium-product-tile-data="([^"]+)"[^>]*>/g)],rows=[];
 for(let i=0;i<matches.length;i++){
  const data=JSON.parse(decode(matches[i][1])),block=html.slice(matches[i].index,matches[i+1]?.index??html.length);
  if(data.line!=='Shoes'||!/ランニング/.test(data.category))fail('nb_category_changed');
  const gender=data.gender==='MEN'?'men':data.gender==='WOMEN'?'women':'unisex';if(gender!=='unisex'&&gender!==audience)continue;
  const buttons=[...block.matchAll(/<button\s+data-style="([^"]+)"([^]*?)<\/button>/g)];if(!buttons.length)fail('nb_colors_missing');
  const path=block.match(/<a href="(\/pd\/[^"?]+\.html)"/)?.[1];if(!path)fail('nb_product_url_missing');
  for(const button of buttons){const code=button[1],s=button[2],get=n=>decode(s.match(new RegExp(n+'="([^"]+)"'))?.[1]||'');const p=JSON.parse(get('data-style-price'));
   rows.push(...makeRows('newbalance',{title:data.productName,styleCode:code,colorName:get('data-full-color-name'),image:get('data-large-src'),url:'https://shop.newbalance.jp'+path+'?'+new URLSearchParams({['dwvar_'+data.masterProductId.replace(/_/g,'__')+'_style']:code}),gender,price:p.sales.value,listingStatus:'listed'}).filter(v=>v.audience===audience));
  }
 }
 const count=Number(html.match(/([\d,]+)\s*アイテム中/)?.[1]?.replace(/,/g,''));if(!Number.isInteger(count)||count<1)fail('nb_total_missing');
 return {rows,observed:matches.length,total:count};
}
export async function collectOfficial(brand,{fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),capture=async()=>{}}={}){
 const b=BRANDS[brand];if(!b||b.source!=='official_site')fail('unknown_brand');const all=new Map(),coverage=[];
 for(const collection of b.collections){let observed=0,excluded=0,pages=0,expected=null;const ids=new Set();
  for(let page=1;page<=25;page++){
   const nb=brand==='newbalance',url=nb?`https://${b.host}/${collection}/?start=${(page-1)*18}&sz=18`:`https://${b.host}/collections/${collection}/products.json?limit=250&page=${page}`;
   const r=await fetcher(url,{headers:{'user-agent':'SHOE-ZAP-Catalog/1.0'},signal:AbortSignal.timeout(30000)});if(!r.ok)fail('official_source_http_'+r.status);
   const text=await r.text();if(text.length>8000000)fail('source_too_large');await capture(brand,collection,page,text);pages++;
   if(nb){const parsed=parseNewBalance(text,/women/.test(collection)?'women':'men');if(expected!==null&&parsed.total!==expected)fail('source_changed_during_collection');expected=parsed.total;observed+=parsed.observed;for(const v of parsed.rows)all.set(v.key,v);if(observed>=expected)break;if(!parsed.observed)fail('incomplete_listing');}
   else{let j;try{j=JSON.parse(text);}catch{fail('source_json_invalid');}if(!Array.isArray(j.products))fail('source_structure_changed');if(!j.products.length){expected=observed;break;}for(const p of j.products){if(ids.has(p.id))fail('pagination_loop');ids.add(p.id);}observed+=j.products.length;const parsed=normalizeShopify(brand,j.products,collection);excluded+=parsed.excluded;for(const v of parsed.rows)all.set(v.key,v);}
   if(page===25)fail('page_limit');await wait(1500);
  }
  if(expected===null||observed!==expected)fail('incomplete_listing');coverage.push({collection,url:`https://${b.host}/${brand==='newbalance'?collection+'/':'collections/'+collection}`,pages,expectedItems:expected,observedItems:observed,excluded,complete:true});await wait(1500);
 }
 if(!all.size)fail('empty_catalog');return {version:1,status:'ok',brand,syncId:crypto.randomUUID(),collectedAt:new Date().toISOString(),coverage,variants:[...all.values()]};
}
export function validateBrandSnapshot(input,now=Date.now()){
 const b=BRANDS[input?.brand];if(!b||input.version!==1||input.status!=='ok'||!/^[-a-f0-9]{36}$/.test(input.syncId||'')||!Array.isArray(input.variants)||!input.variants.length||input.variants.length>3000||Math.abs(now-Date.parse(input.collectedAt))>1800000||!Number.isFinite(Date.parse(input.collectedAt)))fail('invalid_snapshot');
 if(!Array.isArray(input.coverage)||input.coverage.length!==(b.collections?.length||1)||input.coverage.some(c=>c.complete!==true||!Number.isInteger(c.pages)||c.pages<1||c.pages>100||!Number.isInteger(c.expectedItems)||c.expectedItems<0||c.observedItems!==c.expectedItems))fail('incomplete_listing');
 if(b.collections&&b.collections.some(collection=>!input.coverage.some(c=>c.collection===collection&&c.url===`https://${b.host}/collections/${collection}`)))fail('incomplete_listing');
 if(b.shop&&input.coverage[0].url!=='https://www.rakuten.co.jp/'+b.shop+'/')fail('invalid_source');
 const keys=new Set();for(const v of input.variants){if(v.brand!==input.brand||v.source!==b.source||!['men','women'].includes(v.audience)||!['men','women','unisex'].includes(v.gender)||v.gender!=='unisex'&&v.gender!==v.audience||!['road','race','trail','track'].includes(v.category)||!['unknown','regular','wide'].includes(v.width)||!['listed','out_of_stock'].includes(v.listingStatus)||typeof v.styleCode!=='string'||!/^[-A-Z0-9/]{4,50}$/.test(v.styleCode)||v.key!==v.audience+':'+v.styleCode||keys.has(v.key)||!v.title||v.title.length>250||v.modelKey!==`${v.audience}:${modelId(v.title)}:${v.width}`||!safeBrandURL(v.url,input.brand)||!safeBrandURL(v.image,input.brand,true)||!Number.isSafeInteger(v.price)||v.price<1||v.currency!=='JPY'||v.sizeVerified!==false||!Array.isArray(v.matchCodes)||!v.matchCodes.length||v.matchCodes.some(c=>typeof c!=='string'||!/^[-A-Z0-9/]{4,50}$/.test(c)))fail('invalid_variant');keys.add(v.key);}
 return input;
}
export function normalizeOfficialShop(brand,items){
 const b=BRANDS[brand],all=new Map();let excluded=0;
 for(const p of items){
  if(p.shopCode!==b?.shop)fail('unexpected_shop');const name=clean(p.itemName),caption=clean(decode(p.itemCaption));
  if(!/ランニングシューズ/.test(name)||/キッズ|ジュニア|子供|子ども|男の子|女の子|インソール|中敷|ソックス|ケース/.test(name)){excluded++;continue;}
  let gender=/ユニセックス/.test(name)?'unisex':/レディース|ウィメンズ/.test(name)?'women':/メンズ/.test(name)?'men':null;
  let title,styleCode,colorName='色別の品番は未取得・商品ページで確認',colorScope='listing',width=/\bWIDE\b|ワイド/.test(name)?'wide':/STANDARD/.test(name)?'regular':'unknown';
  const url=new URL(p.itemUrl),slug=url.pathname.split('/').filter(Boolean).at(-1).toUpperCase();
  if(brand==='asics'){styleCode=slug;if(!/^\d{4}[A-Z]\d{3}(?:-\d{3})?$/.test(styleCode))fail('asics_code_changed');title=name.replace(/【[^】]*】/g,' ').match(/アシックス\s+(.+?)\s+ランニングシューズ/)?.[1];const color=name.match(/(?:メンズ|レディース|ウィメンズ|ユニセックス)\s+(.+?)\s+(?:STANDARD|WIDE|EXTRA WIDE|NARROW)(?:\s|[｜|])/);if(color)colorName=clean(color[1])+'（色番号未取得）';}
  else if(brand==='puma'){styleCode=slug.replace('_','-');if(!/^\d{6}-\d{2}$/.test(styleCode))fail('puma_code_changed');title=caption.match(/■商品名\s*(.+?)■サイズ/)?.[1]||name;title=title.replace(/^(?:メンズ|ウィメンズ|ユニセックス)\s*/,'').replace(/\s*(?:ランニングシューズ|シューズ)(?:\s.*)?$/,'');colorName='カラー番号 '+styleCode.split('-')[1]+'（色名は商品ページで確認）';colorScope='style_color';}
  else if(brand==='newbalance'){styleCode=slug;if(!/^[MWU][A-Z0-9-]{4,20}$/.test(styleCode)){excluded++;continue;}if(!gender)gender=styleCode.startsWith('W')?'women':styleCode.startsWith('M')?'men':'unisex';const leadText=caption.replace(/^クーポン配布中!\s*/,''),lead=leadText.match(/^(.+?\bv\d+(?:\s+(?:GTX|Gore-Tex[®?]?))?)\s+([A-Z][A-Z0-9/ -]*?)(?=[A-Z][a-z]|[^\x20-\x7E]|$)/)||leadText.match(/^(.+?)\s+([A-Z][A-Z0-9/ -]+)(?=[^\x20-\x7E]|$)/);title=lead?.[1]||name.match(/ニューバランス\s+(.+?)\s+シューズ/)?.[1];if(lead){colorName=lead[2].trim();const modifier=colorName.match(/^(GTX|GORE-TEX)\s+/);if(modifier){title+=' '+modifier[1];colorName=colorName.slice(modifier[0].length);}colorScope='style_color';}}
  else {excluded++;continue;}
  if(!gender){excluded++;continue;}if(!title||p.taxFlag!==0)fail('shop_product_structure_changed');
  const category=/トレイル|TRAIL|NITREL|HIERRO|PEREGRINE/i.test(title+' '+name)?'trail':/スパイク|陸上競技/.test(name)?'track':'road';
  for(const row of makeRows(brand,{title,styleCode,colorName,image:p.mediumImageUrls?.[0]?.imageUrl,url:p.itemUrl,gender,width,category,price:p.itemPrice,listingStatus:p.availability===1?'listed':'out_of_stock'})){
   const v={...row,colorScope},old=all.get(v.key);if(!old||old.listingStatus!=='listed'&&v.listingStatus==='listed'||old.listingStatus===v.listingStatus&&v.price<old.price)all.set(v.key,v);
  }
 }
 return {variants:[...all.values()],excluded};
}
export async function collectOfficialShop(brand,{fetchPage,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const b=BRANDS[brand];if(!b?.shop||!fetchPage)fail('unknown_brand');let expected=0,pages=1;const all=new Map();
 for(let page=1;page<=pages;page++){const j=await fetchPage(brand,page);if(!Array.isArray(j.items)||j.page!==page)fail('source_structure_changed');if(page===1){expected=j.count;pages=j.pageCount;if(!Number.isInteger(expected)||expected<1||expected>3000||!Number.isInteger(pages)||pages<1||pages>100)fail('source_capacity');}if(expected!==j.count||pages!==j.pageCount)fail('source_changed_during_collection');for(const p of j.items)all.set(p.itemCode,p);if(page<pages)await wait(1500);}
 if(all.size!==expected)fail('incomplete_listing');const {variants,excluded}=normalizeOfficialShop(brand,[...all.values()]);if(!variants.length)fail('empty_catalog');return {version:1,status:'ok',brand,syncId:crypto.randomUUID(),collectedAt:new Date().toISOString(),coverage:[{url:'https://www.rakuten.co.jp/'+b.shop+'/',shop:b.shop,keyword:'ランニング',pages,expectedItems:expected,observedItems:all.size,excluded,complete:true}],variants};
}
