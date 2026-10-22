const {AsyncLocalStorage}=require('node:async_hooks');
const storage=new AsyncLocalStorage();
function current(){return storage.getStore()||{tenantId:process.env.STORE_TENANT_ID,branchId:process.env.STORE_BRANCH_ID};}
function run(scope,work){return storage.run({...scope},work);}
function required(){const scope=current();if(!scope.tenantId||!scope.branchId)throw new Error('Store scope is required');return scope;}
module.exports={current,run,required};
