import {clean} from './brands-catalog.mjs';
export const articleFor=v=>v.brand==='brooks'||v.brand==='saucony'?v.styleCode.split('-')[0]:v.styleCode;
export function rakutenURL(value,shop){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='item.rakuten.co.jp'&&!u.username&&!u.password&&u.pathname.startsWith('/'+shop+'/')?u.href:null;}catch{return null;}}
function codePattern(code){return new RegExp('(?:^|[^A-Z0-9])'+code.split(/[-_/]+/).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s_./-]*')+'(?![A-Z0-9])','i');}
export function matchBrandItems(items,variants){
 const offers=new Map();for(const p of items){
  if(p.availability!==1||p.taxFlag!==0||!Number.isSafeInteger(p.itemPrice)||p.itemPrice<1||!/^[-a-z0-9_]+$/i.test(p.shopCode||'')||!rakutenURL(p.itemUrl,p.shopCode))continue;
  const title=clean(p.itemName),caption=clean(p.itemCaption);if(/中古|ユーズド|USED|キッズ|ジュニア|子供|インソール|中敷|シューレース|靴紐|ソックス|シューズケース|シューズ袋/i.test(title))continue;
  const gender=/ユニセックス|男女兼用|メンズ.*(?:レディース|ウィメンズ)|(?:レディース|ウィメンズ).*メンズ/.test(title)?'unisex':/レディース|ウィメンズ|\bWOMEN(?:S|'S)?\b/i.test(title)?'women':/メンズ|\bMEN(?:S|'S)?\b/i.test(title)?'men':null;
  const primary=caption.split(/関連商品|おすすめ商品|対応商品|参考商品/)[0],fields=[...primary.matchAll(/(?:品番|商品番号|スタイルコード|メーカー品番|型番)\s*[:：]?\s*([-A-Z0-9/_. ]{4,80})/gi)].map(m=>m[1]).join(' ');
  for(const v of variants){if(gender&&gender!=='unisex'&&v.gender!=='unisex'&&gender!==v.gender)continue;let basis=null;
   if(v.matchCodes.some(c=>codePattern(c).test(title)))basis='title_style_code';else if(!/(?:\bS\d{5,6}[-_ ]\d{2,4}\b|\bBR[MW]\d{4}[-_][A-Z0-9/]+\b|\bL\d{8}\b)/i.test(title)&&v.matchCodes.some(c=>codePattern(c).test(fields)))basis='description_product_code';if(!basis)continue;
   const id=p.itemCode+'|'+v.key,m=title.match(/(?:^|[^\d])((?:2\d|3[0-5])(?:\.[05])?)\s*cm\b/ig),listedSize=m?.length===1&&!/(?:2\d|3[0-5])(?:\.[05])?\s*[-〜~～]\s*(?:2\d|3[0-5])(?:\.[05])?\s*cm/i.test(title)?Number(m[0].match(/\d+(?:\.\d+)?/)[0]).toFixed(1):null;
   const priceMin=Number.isSafeInteger(p.itemPriceMin3)&&p.itemPriceMin3>0?p.itemPriceMin3:p.itemPrice,priceMax=Number.isSafeInteger(p.itemPriceMax3)&&p.itemPriceMax3>=priceMin?p.itemPriceMax3:Math.max(p.itemPrice,priceMin);
   offers.set(id,{id:p.itemCode,key:v.key,styleCode:v.styleCode,shopCode:p.shopCode,shop:clean(p.shopName),title,url:p.itemUrl,price:p.itemPrice,priceMin,priceMax,currency:'JPY',sizeVerified:false,listedSize,matchBasis:basis,genderBasis:gender?'merchant_title':'official_style_code',multipleStyles:variants.filter(w=>w.key!==v.key&&w.matchCodes.some(c=>codePattern(c).test(title))).some(w=>w.styleCode!==v.styleCode),shipping:p.postageFlag??null});
  }
 }
 return [...offers.values()].sort((a,b)=>a.price-b.price);
}
export function summarizeOffers(offers){return {offerCount:offers.length,candidateLowest:offers.length?Math.min(...offers.map(v=>v.price)):null,shops:new Set(offers.map(v=>v.shopCode)).size};}
