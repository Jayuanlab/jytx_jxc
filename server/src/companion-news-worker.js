'use strict';
const news=require('./companion-news');
async function main(){
 if(process.env.STORE_ENGINE!=='postgres')throw Error('News worker requires configured PostgreSQL');
 const tenantId=process.env.COMPANION_NEWS_TENANT_ID,branchId=process.env.COMPANION_NEWS_BRANCH_ID;
 if(!tenantId||!branchId)throw Error('News worker scope is not configured');
 const context=require('./capacity/context'),pg=require('./capacity/postgres');
 try{const result=await context.run({tenantId,branchId,path:'companion:news-background'},()=>news.refresh(pg));console.log(JSON.stringify(result));if(result.status==='unavailable')process.exitCode=1;}
 finally{await pg.close();}
}
if(require.main===module)main().catch(error=>{console.error('Public news collection failed: '+error.message);process.exitCode=1;});
module.exports={main};
