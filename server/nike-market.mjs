// Product codes come from Nike's catalog. No AI or size-stock inference.
export const MARKET_PAGE_LIMIT=5;
export const MARKET_SOURCE='楽天市場（公式店以外も含む）';
const text=v=>String(v??'').normalize('NFKC').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
export function nikeCodes(value){return [...new Set([...text(value).toUpperCase().matchAll(/(?<![A-Z0-9])([A-Z]{2}\d{4})[\s-]?(\d{3})(?![A-Z0-9])/g)].map(m=>m[1]+'-'+m[2]))];}
export function merchantURL(value,shop){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname==='item.rakuten.co.jp'&&u.pathname.startsWith('/'+shop+'/')?u.href:null;}catch{return null;}}
export function listedSize(title){const s=text(title);if(/(?<![\dA-Z])\d{2}(?:\.\d)?\s*(?:-|~|〜|～|から|to)\s*\d{2}(?:\.\d)?\s*cm\b/i.test(s))return null;const sizes=[...new Set([...s.matchAll(/(?<![\d.])(\d{2}(?:\.\d)?)\s*cm\b/gi)].map(m=>Number(m[1])))];return sizes.length===1&&sizes[0]>=20&&sizes[0]<=35?sizes[0].toFixed(1):null;}
export function filterOffersBySize(offers,size,includeUnknown=true){return offers.filter(o=>o.listedSize?Number(o.listedSize)===Number(size):includeUnknown);}
function titleGender(title){const s=text(title).toLowerCase();if(/ユニセックス|男女兼用|unisex/.test(s))return 'unisex';if(/レディース|ウィメンズ|女性|\bwomen(?:'s|s)?\b|\bwmns\b|\bw\s+(?:air|zoom|vomero|pegasus|structure|alphafly)/.test(s))return 'women';if(/メンズ|男性|\bmen(?:'s|s)?\b/.test(s))return 'men';return null;}
export function matchRakutenItems(items,variants){
 const out=new Map();
 for(const p of items){
  const title=text(p.itemName),caption=text(p.itemCaption),gender=titleGender(title);
  if(p.availability!==1||p.taxFlag!==0||!Number.isSafeInteger(p.itemPrice)||p.itemPrice<=0||!/^[-a-z0-9_]+$/i.test(p.shopCode||'')||!merchantURL(p.itemUrl,p.shopCode))continue;
  if(!/nike|ナイキ/i.test(title)||/中古|\bused\b|古着|新古品|未使用品|リユース|ジュニア|キッズ|子供|\bkids?\b|\bjunior\b|ソックス|靴下|インソール|シューレース|替え紐|シューズケース|シューズバッグ|シューズ袋|クリーナー/i.test(title))continue;
  const titleCodes=nikeCodes(title);
  // Captions often contain recommendations. Accept caption codes only in explicit product-code fields.
  const fieldCodes=[...caption.matchAll(/(?:メーカー品番|商品番号|商品品番|品番|型番|商品コード|スタイルコード)\s*[:：・/\[【(]?\s*([A-Z]{2}\d{4}[\s-]?\d{3})(?![A-Z0-9])/gi)].flatMap(m=>nikeCodes(m[1]));
  for(const v of variants){
   if(gender&&gender!=='unisex'&&gender!==v.audience)continue;
   const inTitle=titleCodes.includes(v.styleCode),inField=!titleCodes.length&&fieldCodes.includes(v.styleCode);
   if(!inTitle&&!inField)continue;
   const codes=inTitle?titleCodes:fieldCodes;
   const priceMin=Number.isSafeInteger(p.itemPriceMin3)&&p.itemPriceMin3>0?p.itemPriceMin3:p.itemPrice;
   const priceMax=Number.isSafeInteger(p.itemPriceMax3)&&p.itemPriceMax3>=priceMin?p.itemPriceMax3:Math.max(p.itemPrice,priceMin);
   const offer={id:p.itemCode,key:v.key,styleCode:v.styleCode,title,shop:text(p.shopName),shopCode:p.shopCode,url:merchantURL(p.itemUrl,p.shopCode),price:p.itemPrice,priceMin,priceMax,shipping:p.postageFlag===0?0:null,currency:'JPY',matchBasis:inTitle?'title_style_code':'description_product_code',genderBasis:gender?'merchant_title':'official_style_code',multipleStyles:codes.length>1,listedSize:listedSize(title),sizeVerified:false};
   const k=v.key+'|'+p.itemCode;if(!out.has(k)||out.get(k).price>offer.price)out.set(k,offer);
  }
 }
 return [...out.values()].sort((a,b)=>a.price-b.price||a.id.localeCompare(b.id));
}
export function marketSummary(offers){return {offerCount:offers.length,shops:new Set(offers.map(o=>o.shopCode)).size,candidateLowest:offers.length?Math.min(...offers.map(o=>o.price)):null};}
