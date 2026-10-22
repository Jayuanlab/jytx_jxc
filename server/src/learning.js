const c=require('./common'),delegation=require('./review-delegation');
const {notice}=require('./feishu-notices');
const LIMIT=1000;
const trim=v=>String(v||'').trim().slice(0,LIMIT);
function list(store,user){return (store.learningRecords||[]).filter(x=>user.roleCode==='owner'||x.employeeId===user.id||delegation.allowed(store,user,'learning',x)).slice().reverse().map(row=>({...row,version:row.version||1,canReview:delegation.allowed(store,user,'learning',row),...(user.roleCode==='owner'?{reviewers:delegation.reviewers(store,'learning',row.employeeId)}:{})}));}
function reference(store,user,kind,id){
 if(!kind&&!id)return null;
 const collections={reception:store.receptions,sale:store.sales,carrier:store.carrierServices,closeout:store.closeouts};
 if(!collections[kind])throw new c.HttpError(400,'关联单据类型不正确');
 const row=(collections[kind]||[]).find(x=>x.id===id);
 if(!row)throw new c.HttpError(404,'关联单据不存在');
 return {kind,id};
}
function create(store,user,payload){
 const event=c.text(payload.event,'参与事件').slice(0,LIMIT);
 const learned=c.text(payload.learned,'学到的内容').slice(0,LIMIT);
 const reflection=c.text(payload.reflection,'心得与复盘').slice(0,LIMIT);
 if(event.length<10||learned.length<10||reflection.length<10)throw new c.HttpError(400,'事件、学到的内容和心得各至少写10字');
 const types=['接待','销售','移动业务','交班','采购','盘点','售后','培训','其他'];
 const type=types.includes(payload.type)?payload.type:'其他';
 const linked=reference(store,user,payload.referenceKind,payload.referenceId);
 const row={id:c.id('LR'),employeeId:user.id,employeeName:user.name,type,event,learned,reflection,linked,status:'待审核',points:null,createdAt:c.now(),reviewedAt:null,reviewedBy:null};
 store.learningRecords ||= [];store.learningRecords.push(row);
 c.audit(store,user,'learning:create',row.id+' '+type);
 notice(store,'learning:'+row.id,'学习单待审核',{id:row.id,summary:user.name+' · '+type+' · '+event.slice(0,60)});
 return row;
}
function review(store,user,payload){
 c.permit(user,'learningReview');
 const row=(store.learningRecords||[]).find(x=>x.id===payload.id);
 if(!row)throw new c.HttpError(404,'学习单不存在');
 delegation.permitReview(store,user,'learning',row);
 if(payload.version!==undefined&&payload.version!==(row.version||1))throw new c.HttpError(409,'学习单已变化，请刷新后审核');
 if(user.roleCode!=='owner'&&payload.version===undefined)throw new c.HttpError(400,'请刷新后提交审核版本');
 if(row.status!=='待审核')throw new c.HttpError(409,'学习单已审核');
 const status=payload.approve===true?'已通过':'未通过';
 const note=trim(payload.note);
 if(status==='未通过'&&!note)throw new c.HttpError(400,'未通过须填写原因');
 const points=status==='已通过'?c.number(payload.points,'学习积分',1):0;
 if(user.roleCode!=='owner'&&points>1000)throw new c.HttpError(400,'受托审核单次最多核定1000积分，超过请老板审核');
 if(!Number.isSafeInteger(points))throw new c.HttpError(400,'积分必须为整数');
 row.version=(row.version||1)+1;row.reviewedByName=user.name;row.status=status;row.points=points;row.reviewNote=note;row.reviewedAt=c.now();row.reviewedBy=user.id;
 c.audit(store,user,'learning:review',row.id+' '+status+' '+points);
 notice(store,'learning-reviewed:'+row.id,'学习单已审核',{id:row.id,summary:row.employeeName+' · '+status+' · '+points+' 积分'});
 return row;
}
module.exports={list,create,review};
