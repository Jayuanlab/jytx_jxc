const test=require('node:test'),assert=require('node:assert/strict');
const output=require('../../web/assistant-tariff-export'),tariffs=require('../src/assistant-tariff-query'),customer=require('../src/assistant-customer');
const mobile=require('../../data/knowledge-imports/mobile-20261009/bundle.json');
const owner={id:'owner',name:'老板',roleCode:'owner',status:'active'},store={employeeKnowledge:mobile.articles};
const query=()=>tariffs.query(store,owner,'整理所有卡资源');

test('每一档资费的通话和四种流量逐项带单位，真实资料范围和出处完整保留',()=>{
 const table=query().table,row=table.rows.find(x=>x.family==='bayu'&&x.baseMonthlyFee===59),text=output.text([row]);
 assert.match(text,/基础月费：59元\/月/);assert.match(text,/通话：500分钟\/月/);assert.match(text,/全国\/通用流量：40GB\/月（原资料标注：全国流量）/);assert.match(text,/重庆流量：80GB\/月/);
 assert.match(text,/定向流量：未列明/);assert.match(text,/资料状态：待核实/);assert.match(text,/资料出处：.*docx/);assert.doesNotMatch(text,/全国\/通用流量：120/);
 const fy=table.rows.find(x=>x.family==='feixiang'&&x.baseMonthlyFee===58);assert.match(output.text([fy]),/通话：500分钟\/月/);assert.match(output.text([fy]),/20GB\/月（原资料标注：通用流量）/);
});
test('范围没写明的流量不能冒充全国流量，缺失值和真实0分开',()=>{
 const row=query().table.rows.find(x=>x.family==='family'&&x.baseMonthlyFee===139),text=output.text([row]);assert.match(text,/全国\/通用流量：未列明/);assert.match(text,/范围未明确流量：50GB\/月（不可作为全国通用流量）/);
 const zero=output.text([{planName:'零值测试',baseMonthlyFee:0,minutes:0,domesticGB:0,chongqingGB:null,directedGB:undefined,status:'needs_review',family:'other',costPrice:9999}]);
 assert.match(zero,/通话：0分钟\/月/);assert.match(zero,/全国\/通用流量：0GB\/月/);assert.match(zero,/重庆流量：未列明/);assert.doesNotMatch(zero,/costPrice|9999/);
});
test('按六种套餐分组无遗漏无重复，每档保留分钟流量和原版本',()=>{
 const rows=query().table.rows,groups=output.types(rows),text=output.text(rows,{groupByType:true});assert.equal(rows.length,44);assert.equal(groups.length,6);assert.equal(groups.reduce((sum,x)=>sum+x.count,0),44);
 assert.equal((text.match(/【\d+】/g)||[]).length,44);for(const type of groups)assert.ok(text.includes('========== '+type.label+'（'+type.count+'档） =========='));
 const sourceType='digital-family';assert.equal(rows.filter(x=>x.family===sourceType&&x.baseMonthlyFee===169).length,3);assert.equal((text.match(/基础月费：169元\/月/g)||[]).length,4);
});
test('顾客清单也保留流量范围和套餐类型，只导出当前顾客允许看的字段',()=>{
 const reply=customer.query(store,owner,{question:'整理所有卡资源'}),text=output.text(reply.table.rows,{groupByType:true});
 assert.equal(reply.table.rows.length,44);assert.equal(output.types(reply.table.rows).length,6);assert.match(text,/全国\/通用流量：未列明/);assert.match(text,/范围未明确流量：50GB\/月/);
 assert.doesNotMatch(text,/资料出处：|资料日期：|articleId|仓库|工资|成本|酬金|提成|老板/);
 const before=JSON.stringify(store);output.text(reply.table.rows);assert.equal(JSON.stringify(store),before);
});

test('新增4G飞享8元档在完整店内和顾客助理中直答套餐外单价，不误触发办卡追问',()=>{
 const c=require('../src/common'),assistant=require('../src/personal-assistant'),{add}=require('../../scripts/add-4g-feixiang-8');
 const owner={id:'boss',name:'老板',roleCode:'owner',status:'active'},s=c.initialize({users:[owner]});add(s,owner);
 for(const mode of ['store','customer']){
  const r=assistant.ask(s,owner,{question:'4G飞享8元档套餐外收费多少',mode});assert.match(r.answer,/0.19元\/分钟/);assert.match(r.answer,/10元\/GB/);assert.equal(r.conversationHint,undefined);
  if(mode==='customer'){assert.equal(r.sources.length,0);assert.equal(r.action,undefined);}
 }
});

