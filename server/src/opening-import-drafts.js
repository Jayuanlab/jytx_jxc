const c=require('./common'),erp=require('./erp');
const boss=store=>(store.users||[]).find(u=>u.roleCode==='owner'&&u.status==='active');
function preview(store,user,rows){
 c.permit(user,'sell');
 const owner=boss(store);if(!owner)throw new c.HttpError(409,'老板账号不可用');
 return erp.openingPreview(store,owner,rows);
}
function list(store,user){
 c.permit(user,'sell');
 return {locked:erp.openingLocked(store),canDecide:user.roleCode==='owner',rows:(store.openingImportDrafts||[]).filter(r=>user.roleCode==='owner'||r.staffId===user.id).map(r=>({id:r.id,source:r.source,staffName:r.staffName,submittedAt:r.submittedAt,status:r.status,productCount:r.productCount,stockValue:r.stockValue,items:r.rows,decisionNote:r.decisionNote||'',decidedAt:r.decidedAt||null}))};
}
function submit(store,user,payload){
 c.permit(user,'sell');if(user.roleCode==='owner')throw new c.HttpError(400,'老板可使用原期初导入，营业员请提交待确认资料');
 const result=preview(store,user,payload.rows);
 const source=String(payload.source||'营业员提交').trim().slice(0,120);
 store.openingImportDrafts||=[];
 if(store.openingImportDrafts.some(r=>r.staffId===user.id&&r.status==='待确认'))throw new c.HttpError(409,'你已有待确认的期初资料');
 const row={id:c.id('OID'),staffId:user.id,staffName:user.name,source,rows:structuredClone(payload.rows),productCount:result.productCount,stockValue:result.stockValue,status:'待确认',submittedAt:c.now()};
 store.openingImportDrafts.push(row);
 c.audit(store,user,'opening-draft:submit',row.id+' '+source);
 require('./feishu-notices').notice(store,'opening-draft:'+row.id,'期初数据待老板核对',{id:row.id,summary:user.name+'提交 '+result.productCount+' 个商品期初数据，请核对后确认'});
 return {id:row.id,status:row.status,productCount:row.productCount,stockValue:row.stockValue};
}
function decide(store,user,payload){
 if(user.roleCode!=='owner')throw new c.HttpError(403,'只有老板能确认期初入账');
 const row=(store.openingImportDrafts||[]).find(r=>r.id===payload.id);
 if(!row)throw new c.HttpError(404,'期初资料不存在');
 if(row.status!=='待确认')throw new c.HttpError(409,'期初资料已处理');
 if(typeof payload.approve!=='boolean')throw new c.HttpError(400,'请选择确认或驳回');
 const note=String(payload.note||'').trim().slice(0,500);
 if(payload.approve){
  const result=erp.openingCommit(store,user,{rows:row.rows,source:'营业员 '+row.staffName+'：'+row.source,confirmed:true});
  row.result={productCount:result.productCount||row.productCount};
  row.status='已入账';
 }else row.status='已驳回';
 row.decidedAt=c.now();row.decidedBy=user.id;row.decisionNote=note;
 c.audit(store,user,'opening-draft:decide',row.id+' '+row.status);
 return {id:row.id,status:row.status,result:row.result||null};
}
function action(store,user,payload){return payload.action==='submit'?submit(store,user,payload):payload.action==='decide'?decide(store,user,payload):(()=>{throw new c.HttpError(400,'期初操作不正确')})();}
module.exports={preview,list,submit,decide,action};


