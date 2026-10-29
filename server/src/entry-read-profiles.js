'use strict';
// GET snapshots only. Write transactions and financial aggregation keep their original reads.
const profiles={
 '/api/carrier-product-commission':['businessOptions'],
 '/api/document-center':[],
 '/api/procurement-plans/payment-documents':['procurementPlans','supplierCash','receipts','suppliers','documentNumbers'],
 '/api/store-wallet-funding-requests':['storeWalletFundingRequests','paymentAccounts','receipts','dailyCloseouts'],
 '/api/payment-accounts':['paymentAccounts'],
 '/api/gifts/rules':[],
 '/api/cash-handovers':['cashHandovers'],
 '/api/cash-handover-recipients':[],
 '/api/work-journal':['workJournals'],
 '/api/daily-closeouts':['dailyCloseouts'],
 '/api/receptions':['receptions','customers','assistCommissionAllocations'],
 '/api/operation-logs':['operationLogs'],
 '/api/qr/products':['products','inventory'],
 '/api/product-price-changes':['productPriceChanges','products'],
};
function options(path,query){
 if(path==='/api/products'&&query.get('view')==='catalog')return {collections:['products'],sharedCollections:[],saleSerialMode:'none'};
 if(['/api/companion/billing/system','/api/companion/billing/manage'].includes(path))return {collections:[],sharedCollections:['companionProfiles'],saleSerialMode:'none'};
 if(path==='/api/normal-payments'&&query.get('entry')==='paid')return {collections:['paymentAccounts','suppliers','fundParties'],sharedCollections:[],saleSerialMode:'none'};
 if(path==='/api/inventory'&&query.get('view')==='materials')return {collections:['products','inventory'],sharedCollections:[],saleSerialMode:'none'};
 if(Object.hasOwn(profiles,path))return {collections:profiles[path],sharedCollections:[],saleSerialMode:'none'};
 return undefined;
}
function compact(row){const out={...row};for(const key of ['importSource','costSources','stockSources','events','revisions','documentVersions','originalDocument'])delete out[key];return out;}
function closeSummary(row){const out={...row},s=row.snapshot||{};for(const key of ['events','revisions','withdrawnSubmissions'])delete out[key];out.snapshot={asOf:s.asOf,salesCount:s.salesCount,returnCount:s.returnCount,mobile:(s.mobile||[]).map(r=>({key:r.key,status:r.status}))};out.detailsDeferred=true;return out;}
module.exports={options,compact,closeSummary,profiles};
