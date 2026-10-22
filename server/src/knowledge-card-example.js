const c=require('./common');
const knowledge=require('./employee-knowledge');
const example=require('../../data/knowledge-cases/card-service-example-20261009.json');
function apply(store,user){
  c.permit(user,'manageUsers');
  const existing=(store.employeeKnowledge||[]).find(row=>row.title===example.title||(row.tags||[]).includes('接待案例20261009'));
  if(existing)return {id:existing.id,title:existing.title,inserted:false};
  const saved=knowledge.save(store,user,structuredClone(example));
  return {id:saved.id,title:saved.title,inserted:true};
}
module.exports={apply};
