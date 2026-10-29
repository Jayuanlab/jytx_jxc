'use strict';
// Presentation only: no account, document, balance, permission or workflow data.
const EXCLUDED=new Set(['/sale-receipt','/payment-receipt','/companion','/companion-admin','/kitty','/family','/display']);
function render(html,route=''){
 if(EXCLUDED.has(route)||!/<head\b/i.test(html)||!/<body\b/i.test(html))return html;
 if(html.includes('id="corporate-clean-style"'))return html;
 html=html.replace(/(src=["']\/(?:store-communication|mobile-nav)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-board-slow$2');
 html=html.replace(/(src=["']\/(?:office|boss-overview)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-inventory-label$2');
 html=html.replace(/(src=["']\/(?:daily-close|daily-compact|daily-withdrawal-ui|notices)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-close-details$2');
 html=html.replace(/((?:src|href)=["']\/(?:payment-splits\.js|sale-payments\.js|daily-funds-layout\.css))(?:\?[^"']*)?(["'])/g,'$1?v=20261023-close-details$2');
 html=html.replace(/(src=["']\/cash-handover\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-close-details$2');
 html=html.replaceAll('现金转存老板银行卡','现金转存老板银行').replaceAll('现金转银行','现金转存老板银行');
 html=html.replace(/((?:src|href)=["']\/pi-work\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-screen-confirm-2$2');
 html=html.replace(/((?:src|href)=["']\/(?:session-controls\.js|session-controls\.css))(?:\?[^"']*)?(["'])/g,'$1?v=20261023-screen-actions-home-exit$2');
 html=html.replace(/((?:src|href)=["']\/(?:office|mobile-nav|home-session-inline|session-controls)\.(?:js|css))(?:\?[^"']*)?(["'])/g,'$1?v=20261023-sales-focus$2');
 html=html.replace(/(src=["']\/work-continuity\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-sales-position$2');
 html=html.replace(/(src=["']\/(?:office|trade-documents|business-reconciliation|feishu-mobile|personal-shortcuts|workbench-directory)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-function-nav$2');
 html=html.replace(/(src=["']\/(?:office|business-reconciliation|workbench-directory)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-function-nav-r2$2');
 html=html.replace(/(src=["']\/mobile-nav\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-function-task$2');
 html=html.replace(/(src=["']\/assistant\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-attendance-task$2');
 html=html.replace(/((?:src|href)=["']\/(?:office\.js|workbench-directory\.js|workbench-directory\.css|work-journal\.js|cash-handover\.js|feishu-mobile\.js))(?:\?[^"']*)?(["'])/g,'$1?v=20261023-grouped-overview$2');
 html=html.replace(/((?:src|href)=["']\/(?:work-continuity\.js|session-controls\.js|corporate-clean\.css|close\.js))(?:\?[^"']*)?(["'])/g,'$1?v=20261023-cash-checkpoint$2');
 html=html.replace(/(src=["']\/work-continuity\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261025-shared-cash-navigation-r2$2');
 html=html.replace(/(src=["']\/(?:close|document-query-client|boss-overview)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-midday-close$2');
 html=html.replace(/(src=["']\/(?:daily-close|boss-overview)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-instant-close$2');
 html=html.replace(/((?:src|href)=["']\/(?:daily-close\.js|daily-compact\.js|cash-handover\.js|topup-pairs\.js|office\.js|corporate-clean\.css))(?:\?[^"']*)?(["'])/g,'$1?v=20261023-model-fixes$2');
 html=html.replace(/((?:src|href)=["']\/(?:feishu-mobile\.js|mobile-nav\.js|home-session-inline\.js|corporate-clean\.css))(?:\?[^"']*)?(["'])/g,'$1?v=20261023-assistant-modules-r2$2');
 html=html.replace(/(src=["']\/sales-list\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-sales-filter-options$2');
 html=html.replace(/(src=["']\/office\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-product-filter-simple$2');
 html=html.replace(/(src=["']\/finance-processing\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-party-groups$2');
 html=html.replace(/((?:src|href)=["']\/(?:daily-close\.js|daily-close\.css))(?:\?[^"']*)?(["'])/g,'$1?v=20261023-daily-entry-stable$2');
 html=html.replace(/(src=["']\/office\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-sale-lean-r2$2');
 html=html.replace(/(src=["']\/(?:office|daily-close|daily-compact|cash-handover|work-journal|business-reconciliation|repair-services)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-module-entry-r2$2');
 html=html.replace(/(src=["']\/(?:office|assistant-finance|finance-processing|sale-fund-responsibility|sale-payments|feishu-mobile)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-store-cash-name$2');
 html=html.replace(/(src=["']\/order-red-packets-ui\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-red-source-batch$2');
 html=html.replace(/(src=["']\/(?:carrier|funds)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-slow-next$2');
 html=html.replace(/(src=["']\/learning\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261023-learning-lazy$2');
  if(route==='/app')html=html.replace(/((?:src|href)=["']\/(?:office-inventory\.js|office\.css))(?:\?[^"']*)?(["'])/g,'$1?v=20261024-inventory-query-compact-r3$2');
 if(route==='/assistant'||route==='/assistant-tools')html=html.replace(/((?:src|href)=["']\/(?:assistant\.js|assistant\.css))(?:\?[^"']*)?(["'])/g,'$1?v=20261027-daily-duty-r1$2');
 html=html.replace(/(src|href)=(['"])(\/(?:mobile-nav\.js|store-communication\.(?:js|css)))(?:\?[^'"<>]*)?\2/g,'$1=$2$3?v=20261024-screen-home-label-v3$2');
 if(route==='/m')html=html.replace(/(src=["']\/store-communication\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261024-boss-inline-r1$2');
 if(route==='/m')html=html.replace(/(src=["']\/mobile-nav\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261024-home-top-row-r1$2');
  if(route==='/app')html=html.replace(/((?:src|href)=["']\/office\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261024-catalog-tree-archive-r4$2');
 if(route==='/app')html=html.replace(/((?:src|href)=["']\/office\.css)(?:\?[^"']*)?(["'])/g,'$1?v=20261024-catalog-tree-archive-r1$2');
 if(route==='/boss-overview')html=html.replace(/(src=["']\/boss-overview\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261024-boss-entry-r1$2');
 if(route==='/m')html=html.replace(/(href=["']\/feishu-mobile\.css)(?:\?[^"']*)?(["'])/g,'$1?v=20261024-brand-top-r1$2');
 html=html.replace(/((?:src|href)=["']\/store-communication\.(?:js|css))(?:\?[^"']*)?(["'])/g,'$1?v=20261024-approved-screen-batch-r2$2');
 html=html.replace(/(src=["']\/mobile-nav\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261024-screen-assistant-loader-r1$2');
 if(route==='/m')html=html.replace(/(src=["']\/mobile-nav\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261024-brand-top-r1$2');
 html=html.replace(/((?:src|href)=["']\/(?:order-red-packets(?:-ui)?\.(?:js|css)|office\.js|carrier\.js|cash-handover\.js|daily-close\.js|gift-approvals\.js|learning\.js|office-gifts\.js|office-pricing\.js|office-red\.js|receptions\.js|repair-materials\.js|sale-payments\.js|sales-list\.js|search\.js|stocktake\.js|subsidy\.js|trade-documents\.js|work-journal\.js))(?:\?[^"']*)?(["'])/g,'$1?v=20261024-document-center-r2$2');
 html=html.replace(/((?:src|href)=["']\/(?:feishu-mobile\.js|funding-hub\.(?:js|css)|document-center\.(?:js|css)|air-accounts\.js|air-accounts-entry\.js|store-wallet-funding\.js))(?:\?[^"']*)?(["'])/g,'$1?v=20261024-document-center-r2$2');
 if(route==='/assistant')html=html.replace(/((?:src|href)=["']\/pi-work\.(?:js|css))(?:\?[^"']*)?(["'])/g,'$1?v=20261024-phone-specs-r1$2');
 const classes=['corporate-clean' ,...(route==='/assistant'?['corporate-pi']:[])];
 html=html.replace(/<body\b([^>]*)>/i,(_tag,attrs)=>{
  const pattern=/\bclass\s*=\s*(["'])(.*?)\1/i;
  if(pattern.test(attrs))attrs=attrs.replace(pattern,(_m,q,value)=>'class='+q+[...new Set(value.split(/\s+/).concat(classes))].join(' ')+q);
  else attrs+=' class="'+classes.join(' ')+'"';
  return '<body'+attrs+' data-ui-style="corporate-clean">';
 });
 // First declared layer wins important cascade against historical accessibility
 // layers. Keep the same approved normal/large type scale and minimum targets.
 html=html.replace(/(src|href)=(["'])(\/(?:daily-close|daily-compact|close|batch-review|boss-overview|brain|carrier|business-reconciliation|feishu-mobile)\.js)(?:\?[^"']*)?\2/g,'$1=$2$3?v=20261024-unified-close-r1$2');
 html=html.replace(/((?:src|href)=["']\/(?:office-inventory\.js|office\.css))(?:\?[^"']*)?(["'])/g,'$1?v=20261024-inventory-level1-r3$2');
 if(route==='/daily-close')html=html.replace(/((?:src|href)=["']\/daily-close\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261026-cash-count-r1$2');
 if(route==='/app')html=html.replace(/((?:src|href)=["']\/(?:office-inventory\.js|office\.css))(?:\?[^"']*)?(["'])/g,'$1?v=20261026-phone-model-serial-r2$2');
 if(route!=='/m'&&route!=='/login')html=html.replace(/<\/head>/i,'<link id="ui-task-reading-style" rel="stylesheet" href="/ui-task-reading.css?v=20261027-all-blocks-r1"></head>').replace(/<\/body>/i,'<script defer src="/ui-task-reading.js?v=20261027-all-blocks-r1"></script></body>');
 return html.replace(/<head\b([^>]*)>/i,'<head$1><link id="corporate-clean-style" rel="stylesheet" href="/corporate-clean.css?v=20261023-assistant-modules-r2">');
}
module.exports={render,EXCLUDED};

const transferRender=module.exports.render;
if(transferRender)module.exports.render=function(...args){return transferRender(...args).replace(/((?:src|href)=["']\/(?:office\.js|trade-documents\.js|business-reconciliation\.js|feishu-mobile\.js))(?:\?[^"']*)?(["'])/g,'$1?v=20261024-store-transfer-r1$2').replace(/((?:src|href)=["']\/(?:feishu-mobile|pending-alerts)\.(?:js|css))(?:\?[^"']*)?(["'])/g,'$1?v=20261025-alert-urge-r1$2');};

const salesSplitRender=module.exports.render;module.exports.render=function(...args){return salesSplitRender(...args).replace(/((?:src|href)=["']\/sales-list\.(?:js|css))(?:\?[^"']*)?(["'])/g,'$1?v=20261024-independent-sales-pages-r1$2');};

// Keep the payment page's current assets ahead of the older global cache stamps.
const paymentSimpleRender=module.exports.render;
module.exports.render=function(...args){return paymentSimpleRender(...args).replace(/((?:src|href)=["']\/business-reconciliation\.(?:js|css))(?:\?[^"']*)?(["'])/g,'$1?v=20261026-payment-simple-r1$2');};

// Apply the current workbench and search versions after the historical wrappers.
const directEntryRender=module.exports.render;
module.exports.render=function(html,route,...rest){
 let rendered=directEntryRender(html,route,...rest);
 if(route==='/m')rendered=rendered.replace(/(src=["']\/feishu-mobile\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261027-direct-entry-v2$2');
 if(route==='/search')rendered=rendered.replace(/(src=["']\/search\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261027-functions-v2$2');
 return rendered;
};

// Keep the three finance scripts on the published lazy-loading version.
const financeSpeedRender=module.exports.render;
module.exports.render=function(html,route,...rest){
 const rendered=financeSpeedRender(html,route,...rest);
 return route==='/funds'?rendered.replace(/(src=["']\/(?:funds|fund-ledgers|finance-processing)\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261029-lazy-finance-r1$2'):rendered;
};

// Keep the phone confirmation script ahead of older shared cache stamps.
const financeTouchRender=module.exports.render;
module.exports.render=function(html,route,...rest){
 const rendered=financeTouchRender(html,route,...rest);
 return route==='/assistant-finance'?rendered.replace(/(src=["']\/assistant-finance\.js)(?:\?[^"']*)?(["'])/g,'$1?v=20261029-misclick-r1$2'):rendered;
};
