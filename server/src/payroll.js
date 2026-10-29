const c = require("./common");

function validateRule(payload) {
  const mode = payload.mode;
  if (!["piece", "profit", "none"].includes(mode))
    throw new c.HttpError(400, "请选择提成方式");
  const value =
    mode === "none"
      ? 0
      : c.money(payload.value, mode === "profit" ? "提成百分比" : "每件提成");
  if (mode === "profit" && value > 100)
    throw new c.HttpError(400, "提成比例不能超过100%");
  return { mode, value };
}
function currentRule(store, skuId, at = c.now(), employeeId = '') {
  return (
    store.commissionRules
      .filter((r) => r.skuId === skuId && r.effectiveAt <= at && (!r.employeeId || r.employeeId===employeeId))
      .sort((a, b) => b.sequence - a.sequence)[0] || null
  );
}
function saveRule(store, user, payload) {
  c.permit(user, "managePay");
  if (!store.products.some((p) => p.skuId === payload.skuId))
    throw new c.HttpError(404, "商品不存在");
  const employeeId=String(payload.employeeId||'').trim();
  if(employeeId){
    const employee=c.userById(store,employeeId);
    if(employee.roleCode==='owner'||employee.roleCode==='personal-assistant'||employee.assistantCustomerOnly)throw new c.HttpError(400,'请选择门店员工');
  }
  const rule = {
    id: c.id("RULE"),
    skuId: payload.skuId,
    employeeId,
    ...validateRule(payload),
    effectiveAt: c.now(),
    sequence: store.commissionRules.length + 1,
    operatorId: user.id,
  };
  store.commissionRules.push(rule);
  let resolvedPending=0;
  for(const entry of store.commissionEntries||[]){
    if(entry.kind!=='sale'||entry.amount!=null||entry.month!==c.month()||(employeeId&&entry.employeeId!==employeeId))continue;
    const order=(store.sales||[]).find(row=>row.id===entry.orderId);
    const item=order?.items?.find(row=>row.id===entry.itemId);
    if(item?.skuId!==payload.skuId)continue;
    if((store.payrollStatements||[]).some(row=>row.employeeId===entry.employeeId&&row.month===entry.month))continue;
    resolveEntry(store,user,entry.id,{mode:rule.mode,value:rule.value});entry.ruleId=rule.id;resolvedPending++;
  }
  c.audit(store, user, "commission:rule", `设置 ${payload.skuId} ${employeeId||'全体员工'}提成`);
  return {...rule,resolvedPending};
}
function salaryAt(store, employeeId, targetMonth) {
  return (
    store.salaryRates
      .filter(
        (r) => r.employeeId === employeeId && r.effectiveMonth <= targetMonth,
      )
      .sort(
        (a, b) =>
          b.effectiveMonth.localeCompare(a.effectiveMonth) ||
          b.sequence - a.sequence,
      )[0] || null
  );
}
function saveSalary(store, user, payload) {
  c.permit(user, "managePay");
  const employee = c.userById(store, payload.employeeId);
  if(employee.assistantCustomerOnly||employee.roleCode==="personal-assistant")throw new c.HttpError(400,"个人助理使用者不属于门店员工");
  const effectiveMonth = c.validMonth(payload.effectiveMonth);
  const nextMonth = store.salaryRates
    .filter(
      (r) => r.employeeId === employee.id && r.effectiveMonth > effectiveMonth,
    )
    .map((r) => r.effectiveMonth)
    .sort()[0];
  if (
    store.payrollStatements.some(
      (p) =>
        p.employeeId === employee.id &&
        p.month >= effectiveMonth &&
        (!nextMonth || p.month < nextMonth),
    )
  )
    throw new c.HttpError(
      409,
      "这次调整会影响已确认工资，请选择之后的生效月份",
    );
  const row = {
    id: c.id("SALARY"),
    employeeId: employee.id,
    effectiveMonth,
    amount: c.money(payload.amount, "基础工资"),
    sequence: store.salaryRates.length + 1,
    createdAt: c.now(),
    operatorId: user.id,
  };
  store.salaryRates.push(row);
  c.audit(
    store,
    user,
    "salary:change",
    `调整 ${employee.name} ${effectiveMonth} 底薪`,
  );
  return row;
}
function calculate(rule, item) {
  if (!rule) return null;
  if (rule.mode === "piece") return c.round(item.quantity * rule.value);
  if (rule.mode === "profit")
    return c.round((Math.max(0, item.profit) * rule.value) / 100);
  return 0;
}
function accrue(store, order, item) {
  const rule = currentRule(store, item.skuId, order.createdAt, order.salespersonId||order.operatorId);
  const entry = {
    id: c.id("COM"),
    employeeId: order.salespersonId,
    orderId: order.id,
    itemId: item.id,
    productName: item.name,
    quantity: item.quantity,
    profit: item.profit,
    mode: rule ? rule.mode : "unconfigured",
    value: rule ? rule.value : null,
    ruleId: rule ? rule.id : null,
    amount: calculate(rule, item),
    month: c.month(order.createdAt),
    createdAt: order.createdAt,
    kind: "sale",
  };
  store.commissionEntries.push(entry);
  return entry;
}
function businessSources(store,employeeId,targetMonth){
  const existing=id=>(store.commissionEntries||[]).some(entry=>entry.kind==='business'&&entry.orderId===id);
  const carriers=(store.carrierServices||[]).filter(row=>row.employeeId===employeeId&&c.month(row.serviceDate)===targetMonth);
  const recharges=(store.airRechargeEvents||[]).filter(row=>row.kind==='customer_recharge'&&row.operatorId===employeeId&&c.month(row.businessDate)===targetMonth);
  const sources=[];
  for(const row of recharges){const carrier=carriers.find(item=>row.reference&&row.reference===item.externalOrderNo&&row.businessDate===item.serviceDate);if(carrier&&!existing(row.id))continue;sources.push({sourceId:row.id,sourceType:'air_recharge',employeeId,date:row.businessDate,createdAt:row.createdAt,label:'顾客现金充值'});}
  return sources;
}
function accrueBusiness(store,sourceId){
  const source=(store.carrierServices||[]).find(row=>row.id===sourceId)||(store.airRechargeEvents||[]).find(row=>row.id===sourceId&&row.kind==='customer_recharge');
  if(!source)throw new c.HttpError(404,'业务单不存在');
  const employeeId=source.employeeId||source.operatorId,date=source.serviceDate||source.businessDate,selected=businessSources(store,employeeId,c.month(date)).find(row=>row.sourceId===sourceId);
  const employee=(store.users||[]).find(row=>row.id===employeeId);
  if(employee?.roleCode==='owner'&&!(store.salaryRates||[]).some(row=>row.employeeId===employeeId))return null;
  if(!selected)return null;
  if((store.commissionEntries||[]).some(entry=>entry.kind==='business'&&entry.orderId===sourceId))return null;
  if((store.payrollStatements||[]).some(row=>row.employeeId===employeeId&&row.month===c.month(date)))return null;
  const entry={id:c.id('COM'),kind:'business',businessKind:selected.sourceType,employeeId,orderId:sourceId,itemId:sourceId,productName:selected.label,quantity:1,profit:0,mode:'unconfigured',value:null,amount:null,month:c.month(date),createdAt:selected.createdAt,businessDate:date};
  store.commissionEntries.push(entry);return entry;
}
function carrierRate(store,user,payload){
  c.permit(user,'managePay');
  const row=(store.carrierServices||[]).find(item=>item.id===c.text(payload.id,'移动业务单号'));
  if(!row)throw new c.HttpError(404,'移动业务单不存在');
  const rate=c.money(payload.rate,'员工返费提成比例');
  if(rate>100)throw new c.HttpError(400,'提成比例不能超过100%');
  const entries=(store.commissionEntries||[]).filter(item=>item.kind==='carrier_rebate'&&item.orderId===row.id);
  if(entries.some(item=>(store.payrollStatements||[]).some(statement=>statement.employeeId===item.employeeId&&statement.month===item.month)))throw new c.HttpError(409,'已有到账期次的工资已确认，不能修改比例；请另记工资更正');
  row.employeeCommissionRate=rate;
  for(const part of row.schedule||[])for(const event of part.events||[])accrueCarrierReceipt(store,row,part,event);
  for(const entry of entries){entry.value=rate;entry.amount=c.round(Number(entry.receivedAmount||0)*rate/100);entry.mode='carrier_percent';}
  c.audit(store,user,'commission:carrier-rate',row.id+' 员工返费比例 '+rate+'%');
  return {id:row.id,rate};
}
function accrueCarrierReceipt(store,row,part,event){
  if((store.commissionEntries||[]).some(item=>item.kind==='carrier_rebate'&&item.itemId===event.id))return null;
  let month=c.month(event.createdAt);const rate=row.employeeCommissionRate;
  while((store.payrollStatements||[]).some(item=>item.employeeId===row.employeeId&&item.month===month)){
    const [year,number]=month.split('-').map(Number);month=new Date(Date.UTC(year,number,1)).toISOString().slice(0,7);
  }
  const entry={id:c.id('COM'),kind:'carrier_rebate',businessKind:'carrier',employeeId:row.employeeId,orderId:row.id,itemId:event.id,productName:'移动返费 · '+(row.typeName||row.type||'业务')+' · '+part.month,quantity:1,mode:'carrier_percent',value:rate??null,receivedAmount:event.amount,profit:0,amount:rate==null?null:c.round(event.amount*rate/100),month,createdAt:event.createdAt,businessDate:row.serviceDate,settlementMonth:part.month};
  store.commissionEntries.push(entry);return entry;
}
function carrierInstallments(store,employeeId,targetMonth){
  const result=[];
  for(const row of store.carrierServices||[]){
    if(row.employeeId!==employeeId)continue;
    for(const part of row.schedule||[]){
      if(part.month!==targetMonth)continue;
      const basis=part.confirmed==null?part.expected:part.confirmed,received=Number(part.received||0),rate=row.employeeCommissionRate;
      result.push({orderId:row.id,orderNo:row.externalOrderNo,employeeId,serviceDate:row.serviceDate,month:part.month,productName:row.typeName||row.type||'移动业务',expected:part.expected,confirmed:part.confirmed,received,companyOutstanding:c.round(Math.max(0,basis-received)),rate:rate??null,estimatedWage:rate==null?null:c.round(basis*rate/100),earnedWage:rate==null?null:c.round(received*rate/100),unreceivedWage:rate==null?null:c.round(Math.max(0,basis-received)*rate/100),status:part.confirmed==null?'待移动确认':received>=part.confirmed?'已到账':'未全部到账'});
    }
  }
  return result;
}
function ensureBusinessEntry(store,user,payload){
  c.permit(user,'managePay');const sourceId=c.text(payload.sourceId,'业务单号');
  const entry=accrueBusiness(store,sourceId);
  if(!entry)throw new c.HttpError(409,'已有工资记录或该业务与已有充值记录相同，请刷新核对');
  c.audit(store,user,'commission:business-ensure',sourceId+' 已建立待核定工资记录');return publicEntry(store,entry);
}
function giftAdjustment(store, order, gift, onlyEntry = null) {
  const entries = onlyEntry ? [onlyEntry] : store.commissionEntries.filter(
    (entry) => entry.orderId === order.id && entry.kind === "sale",
  );
  const positive = order.items.reduce((sum, item) => sum + Math.max(0, Number(item.profit || 0)), 0);
  if (!positive) return [];
  const created = [];
  for (const entry of entries) {
    if (entry.mode !== "profit" || entry.amount == null) continue;
    if (store.commissionEntries.some((row) => row.kind === "gift" && row.originalId === entry.id && row.giftId === gift.id)) continue;
    const share = Number(gift.cost || 0) * Math.max(0, Number(entry.profit || 0)) / positive;
    const amount = -c.round(share * Number(entry.value || 0) / 100);
    if (!amount) continue;
    let month = c.month(gift.createdAt);
    while (store.payrollStatements.some((row) => row.employeeId === entry.employeeId && row.month === month)) {
      const [year, number] = month.split("-").map(Number);
      month = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
    }
    const adjustment = {
      id: c.id("COM"), kind: "gift", mode: "manual",
      orderId: order.id, giftId: gift.id, originalId: entry.id,
      employeeId: entry.employeeId, amount, month,
      createdAt: gift.createdAt, reason: "赠品成本抵减毛利提成",
    };
    store.commissionEntries.push(adjustment);
    created.push(adjustment);
  }
  return created;
}
function reverse(
  store,
  order,
  item,
  returnedQty,
  totalReturnedQty,
  returnId,
  at,
  cumulativeProfit,
) {
  const original = store.commissionEntries.find(
    (e) => e.itemId === item.id && e.kind === "sale",
  );
  if (!original) return;
  const previous = store.commissionEntries
    .filter((e) => e.originalId === original.id && e.kind === "return")
    .reduce((n, e) => n + Number(e.amount || 0), 0);
  const exactProfit=Number.isFinite(cumulativeProfit)&&original.mode==="profit";
  const target=exactProfit?(totalReturnedQty===item.quantity?original.amount:c.round(original.amount-c.round(Math.max(0,original.profit-cumulativeProfit)*original.value/100))):c.round(original.amount*totalReturnedQty/item.quantity);
  const previousProfit=store.commissionEntries.filter(e=>e.originalId===original.id&&e.kind==="return").reduce((n,e)=>n+Number(e.profit||0),0);
  const amount =
    original.amount == null
      ? null
      : c.round(
          -target -
            previous,
        );
  store.commissionEntries.push({
    ...original,
    id: c.id("COM"),
    kind: "return",
    originalId: original.id,
    returnId,
    quantity: -returnedQty,
    cumulativeQuantity: totalReturnedQty,
    ...(Number.isFinite(cumulativeProfit)?{cumulativeProfit}:{}),
    profit: Number.isFinite(cumulativeProfit)?c.round(-cumulativeProfit-previousProfit):-c.round((item.profit * returnedQty) / item.quantity),
    amount,
    month: c.month(at),
    createdAt: at,
  });
}
function resolveEntry(store, user, entryId, payload) {
  c.permit(user, "managePay");
  const entry = store.commissionEntries.find(
    (e) => e.id === entryId && ["sale","business"].includes(e.kind),
  );
  if (!entry || entry.amount != null)
    throw new c.HttpError(409, "这笔提成已核定或不存在");
  const linked = store.commissionEntries.filter(
    (e) => e.originalId === entry.id && e.kind === "return",
  );
  if (
    [entry, ...linked].some((e) =>
      store.payrollStatements.some(
        (p) => p.employeeId === e.employeeId && p.month === e.month,
      ),
    )
  )
    throw new c.HttpError(409, "关联工资已确认");
  const rule = validateRule(payload);
  if(entry.kind==='business'&&rule.mode==='profit')throw new c.HttpError(400,'移动业务与现金充值须核定固定提成或明确不提成，不能按销售毛利计算');
  Object.assign(entry, rule, {
    amount: calculate(rule, entry),
    resolvedBy: user.id,
    resolvedAt: c.now(),
  });
  let reversed = 0;
  for (const adjustment of linked) {
    const cumulative = c.round(
      rule.mode==="profit"&&Number.isFinite(adjustment.cumulativeProfit)?(adjustment.cumulativeQuantity===entry.quantity?entry.amount:entry.amount-c.round(Math.max(0,entry.profit-adjustment.cumulativeProfit)*rule.value/100)):(entry.amount * adjustment.cumulativeQuantity) / entry.quantity,
    );
    Object.assign(adjustment, rule, {
      amount: c.round(-(cumulative - reversed)),
    });
    reversed = cumulative;
  }
  if (entry.kind==='sale'&&rule.mode === "profit") {
    const order = store.sales.find((row) => row.id === entry.orderId);
    for (const gift of order?.giftOrders || []) giftAdjustment(store, order, gift, entry);
  }
  c.audit(store, user, "commission:resolve", `补录 ${entry.orderId} 提成`);
  return entry;
}
// Read-only payroll details use explicit fields; internal costs and profits are excluded.
const knownAmount = row => row.amount != null && Number.isFinite(Number(row.amount));
const employeeName = (store,id) => store.users.find(row=>row.id===id)?.name || "";
function publicFields(row,keys) {return Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));}
function orderNo(store,id) {
  if(!id)return "";
  const order=store.sales.find(row=>row.id===id);
  return order?.displayNo || order?.orderNo || String(id).replace(/^([A-Z]{2,5})-([0-9a-f]{8})-[0-9a-f-]{20,}$/i, "$1-$2");
}
function publicEntry(store,row) {
  return {...publicFields(row,["id","employeeId","orderId","receptionId","itemId","productName","quantity","createdAt","kind","businessKind","businessDate","settlementMonth","receivedAmount","mode","value","ruleId","month","reason","originalId","returnId","giftId","assistId","resolvedAt","resolvedBy"]),
    employeeName:employeeName(store,row.employeeId),orderNo:orderNo(store,row.orderId),
    date:row.createdAt?c.day(row.createdAt):"",amount:knownAmount(row)?Number(row.amount):null,status:knownAmount(row)?"accrued":"pending"};
}
function publicAdjustment(store,row) {
  return {...publicFields(row,["id","employeeId","month","direction","amount","signedAmount","reason","sourceOrderId","originalStatementId","createdAt","operatorId","operatorName"]),
    employeeName:employeeName(store,row.employeeId),orderNo:orderNo(store,row.sourceOrderId)};
}
function businessChecks(store,employeeId,targetMonth) {
  const entries=store.commissionEntries.filter(row=>row.employeeId===employeeId&&row.month===targetMonth&&['sale','business'].includes(row.kind)),result=[];
  for(const order of store.sales){
    if((order.salespersonId||order.operatorId)!==employeeId||c.month(order.createdAt)!==targetMonth)continue;
    for(const item of order.items||[]){
      const matched=entries.filter(row=>row.orderId===order.id&&row.itemId===item.id);
      const status=!matched.length?"missing":matched.some(row=>!knownAmount(row))?"pending":"accrued";
      result.push({employeeId,employeeName:employeeName(store,employeeId),orderId:order.id,orderNo:orderNo(store,order.id),itemId:item.id,
        productName:item.name,businessKind:order.repairContext?.kind==='repair'||item.type==='维修'?'repair':'sale',profit:item.profit,quantity:item.quantity,date:c.day(order.createdAt),createdAt:order.createdAt,status,
        amount:status==="accrued"?c.round(matched.reduce((sum,row)=>sum+Number(row.amount),0)):null,entryIds:matched.map(row=>row.id)});
    }
  }
  for(const source of businessSources(store,employeeId,targetMonth)){
    const matched=entries.filter(row=>row.kind==='business'&&row.orderId===source.sourceId);
    const status=!matched.length?'missing':matched.some(row=>!knownAmount(row))?'pending':'accrued';
    result.push({employeeId,employeeName:employeeName(store,employeeId),orderId:source.sourceId,orderNo:source.sourceId,itemId:source.sourceId,sourceType:source.sourceType,productName:source.label,quantity:1,date:source.date,createdAt:source.createdAt,status,amount:status==='accrued'?c.round(matched.reduce((sum,row)=>sum+Number(row.amount),0)):null,entryIds:matched.map(row=>row.id)});
  }
  for(const row of store.carrierServices||[]){
    if(row.employeeId!==employeeId||c.month(row.serviceDate)!==targetMonth)continue;
    result.push({employeeId,employeeName:employeeName(store,employeeId),orderId:row.id,orderNo:row.externalOrderNo,itemId:row.id,sourceType:'carrier',productName:'移动业务 · '+(row.typeName||row.type||'办理'),quantity:1,date:row.serviceDate,createdAt:row.createdAt,status:'deferred',amount:null,entryIds:[]});
  }
  return result;
}
function pointsFor(store,id,targetMonth) {
  if(!id)return [];
  const rows=[];
  const add=(sourceId,type,label,at,points,pointId,month)=>{if(at&&(month||c.month(at))===targetMonth)rows.push({id:pointId||sourceId,employeeId:id,employeeName:employeeName(store,id),sourceId,sourceType:type,kind:label,points:Number(points||0),createdAt:at,date:c.day(at),status:"confirmed"});};
  for(const reception of store.receptions||[])for(const point of reception.points||[])if(point.employeeId===id&&point.confirmedBy)add(reception.id,"reception",point.kind,point.at,point.amount,point.id,point.month);
  for(const record of store.learningRecords||[])if(record.employeeId===id&&record.status==="已通过"&&record.reviewedBy)add(record.id,"learning",record.event||"学习单",record.reviewedAt,record.points);
  for(const record of store.workJournals||[])if(record.employeeId===id&&record.status==="已核定"&&record.reviewedBy)add(record.id,"work-journal",record.event||"工作日志",record.reviewedAt,record.points);
  return rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
const pointWage=rows=>c.round(rows.reduce((sum,row)=>sum+Number(row.points||0),0)/100);
function wageRow(store, employee, targetMonth) {
  const saved = store.payrollStatements.find(
    (p) => p.employeeId === employee.id && p.month === targetMonth,
  );
  if (saved) return { ...saved, manualAdjustment:saved.manualAdjustment || 0, manualAdd:saved.manualAdd || 0, manualDeduct:saved.manualDeduct || 0, missing:saved.missing || 0, pointWage:saved.pointWage??null, pointIds:saved.pointIds||[], name: employee.name, role: employee.role };
  const salary = salaryAt(store, employee.id, targetMonth);
  const entries = store.commissionEntries.filter(
    (e) => e.employeeId === employee.id && e.month === targetMonth,
  );
  const piece = c.round(
    entries
    .filter((e) => ['sale','business'].includes(e.kind) && e.mode === "piece")
      .reduce((s, e) => s + Number(e.amount || 0), 0),
  );
  const profit = c.round(
    entries
    .filter((e) => (['sale','business'].includes(e.kind) && e.mode === "profit") || ['carrier_rebate','reception_bonus'].includes(e.kind))
      .reduce((s, e) => s + Number(e.amount || 0), 0),
  );
  const adjustment = c.round(
    entries
      .filter((e) => ['return','assist_transfer','gift','reception_bonus_adjustment'].includes(e.kind))
      .reduce((s, e) => s + Number(e.amount || 0), 0),
  );
  const pending = entries.filter((e) => e.amount == null).length;
  const commission = c.round(piece + profit + adjustment);
  const missing = businessChecks(store,employee.id,targetMonth).filter(row=>row.status === "missing").length;
  const manualRows = (store.payrollAdjustments || []).filter(row=>row.employeeId===employee.id && row.month===targetMonth);
  const manualAdd = c.round(manualRows.filter(row=>row.direction==="add").reduce((sum,row)=>sum+row.amount,0));
  const manualDeduct = c.round(manualRows.filter(row=>row.direction==="deduct").reduce((sum,row)=>sum+row.amount,0));
  const manualAdjustment = c.round(manualAdd-manualDeduct);
  const points=pointsFor(store,employee.id,targetMonth),pointTotal=points.reduce((sum,row)=>sum+Number(row.points||0),0),convertedPoints=pointWage(points);
  return {
    employeeId: employee.id,
    name: employee.name,
    role: employee.role,
    month: targetMonth,
    baseSalary: salary ? salary.amount : null,
    pieceCommission: piece,
    profitCommission: profit,
    adjustment,
    commission,
    pending, pointTotal, pointWage:convertedPoints, pointIds:points.map(row=>row.id),
    missing, manualAdd, manualDeduct, manualAdjustment,
    adjustmentIds:manualRows.map(row=>row.id),
    total: salary && !pending && !missing ? c.round(salary.amount + commission + manualAdjustment + convertedPoints) : null,
    status: "draft",
    entryIds: entries.map((e) => e.id),
  };
}
function getPayroll(store, user, targetMonth, employeeId) {
  c.validMonth(targetMonth);
  const caps = c.capabilities(user);
  if(user.assistantCustomerOnly === true || user.roleCode === "customer-assistant" || user.roleCode === "personal-assistant")throw new c.HttpError(403,"顾客模式不能查看工资");
  if (employeeId && employeeId !== user.id && !caps.viewAllPay)
    throw new c.HttpError(403, "只能查看本人工资");
  const employees = caps.viewAllPay
    ? store.users.filter(
        (u) =>
          !u.assistantCustomerOnly && u.roleCode!=="personal-assistant" && (u.roleCode !== "owner" ||
          store.salaryRates.some((r) => r.employeeId === u.id)),
      )
    : [user];
  const rows = employees
    .filter((u) => !employeeId || u.id === employeeId)
    .map((u) => wageRow(store, u, targetMonth));
  const selected = employeeId || (!caps.viewAllPay ? user.id : "");
  const entries = selected
    ? store.commissionEntries
        .filter((e) => e.employeeId === selected && e.month === targetMonth)
        .filter(e=>{const saved=store.payrollStatements.find(p=>p.employeeId===selected&&p.month===targetMonth);return !saved?.entryIds||saved.entryIds.includes(e.id);})
        .map(e => ({...publicEntry(store,e),...(caps.profit?{profit:e.profit}:{})}))
    : [];
  const checks=selected?businessChecks(store,selected,targetMonth).map(row=>caps.profit?row:(({profit,...rest})=>rest)(row)):[];
  const adjustments=selected?(store.payrollAdjustments||[]).filter(row=>row.employeeId===selected&&row.month===targetMonth).map(row=>publicAdjustment(store,row)):[];
  const selectedRow=rows.find(row=>row.employeeId===selected),points=pointsFor(store,selected,targetMonth).map(row=>({...row,convertedAmount:selectedRow?.pointWage==null||(selectedRow.status!=='draft'&&!selectedRow.pointIds?.includes(row.id))?null:c.round(row.points/100)}));
  return {
    month: targetMonth,
    rows,
    entries, adjustments, businessChecks:checks, carrierInstallments:selected?carrierInstallments(store,selected,targetMonth):[], points,
    pointRules:{conversion:'100分＝1元',basicReception:require('./receptions').settings(store).basic,wechat:200,assist:store.receptionPointRules?.assist??null},
    canAdjust:caps.confirmPay,
    canViewAll: caps.viewAllPay,
    canManage: caps.managePay,
    canConfirm: caps.confirmPay && targetMonth < c.month(),
    totals: {
      baseSalary: c.round(
        rows.reduce((s, r) => s + Number(r.baseSalary || 0), 0),
      ),
      commission: c.round(rows.reduce((s, r) => s + r.commission, 0)),
      pointWage:c.round(rows.reduce((s,r)=>s+Number(r.pointWage||0),0)),
      manualAdjustment:c.round(rows.reduce((sum,row)=>sum+row.manualAdjustment,0)),
      missing:rows.reduce((sum,row)=>sum+row.missing,0),
      total: c.round(rows.reduce((s, r) => s + Number(r.total || 0), 0)),
      incomplete: rows.filter((r) => r.total == null).length,
      points:points.reduce((sum,row)=>sum+row.points,0),
    },
  };
}
// Manual wage changes are new records. Confirmed and paid months retain their totals.
function saveAdjustment(store,user,payload) {
  c.permit(user,"confirmPay");
  const employee=c.userById(store,payload.employeeId),month=c.validMonth(payload.month);
  if(employee.assistantCustomerOnly===true||employee.roleCode==="customer-assistant")throw new c.HttpError(400,"顾客账号不能核定工资");
  if(store.payrollStatements.some(row=>row.employeeId===employee.id&&row.month===month))throw new c.HttpError(409,"该月份工资已确认或已发放，请在未确认月份另记补差");
  if(!["add","deduct"].includes(payload.direction))throw new c.HttpError(400,"请选择增加或减少工资");
  const amount=c.money(payload.amount,"工资增减金额");
  if(amount<=0)throw new c.HttpError(400,"工资增减金额须大于零");
  const reason=c.text(payload.reason,"增减原因");
  if(reason.length>1000)throw new c.HttpError(400,"增减原因不能超过1000字");
  const optional=(value,label)=>{if(value==null||value==="")return "";const result=c.text(value,label);if(result.length>120)throw new c.HttpError(400,`${label}不能超过120字`);return result;};
  const sourceOrderId=optional(payload.sourceOrderId,"来源销售单号"),originalStatementId=optional(payload.originalStatementId,"原工资单号");
  if(sourceOrderId){
    const order=store.sales.find(row=>row.id===sourceOrderId);
    if(!order||((order.salespersonId||order.operatorId)!==employee.id&&!store.commissionEntries.some(row=>row.employeeId===employee.id&&row.orderId===sourceOrderId)))throw new c.HttpError(400,"来源销售单与该员工无关联");
  }
  if(originalStatementId&&!store.payrollStatements.some(row=>row.id===originalStatementId&&row.employeeId===employee.id&&["confirmed","paid"].includes(row.status)))throw new c.HttpError(400,"原工资单不存在或不属于该员工");
  const row={id:c.id("PAYADJ"),employeeId:employee.id,employeeName:employee.name,month,direction:payload.direction,amount,
    signedAmount:payload.direction==="add"?amount:-amount,reason,sourceOrderId,originalStatementId,
    createdAt:c.now(),operatorId:user.id,operatorName:user.name};
  store.payrollAdjustments ||= [];store.payrollAdjustments.push(row);
  c.audit(store,user,"payroll:adjustment",`${row.id} · ${employee.name} · ${month} · ${row.signedAmount}元 · ${reason}`+(sourceOrderId?` · 来源 ${sourceOrderId}`:"")+(originalStatementId?` · 原工资 ${originalStatementId}`:""));
  return publicAdjustment(store,row);
}
function settings(store, user, targetMonth) {
  c.permit(user, "managePay");
  c.validMonth(targetMonth);
  return {
    month: targetMonth,
    staff: store.users
      .filter((u) => u.roleCode !== "owner" && !u.assistantCustomerOnly && u.roleCode !== "personal-assistant")
      .map((u) => ({
        ...c.publicUser(u),
        salary: salaryAt(store, u.id, targetMonth),
      })),
    products: store.products
      .filter((p) => p.active !== false)
      .map((p) => ({
        skuId: p.skuId,
        name: p.name,
        externalCode: p.externalCode,
        type: p.type,
        unit: p.unit,
        rule: currentRule(store, p.skuId),
        employeeRules:store.users.filter(u=>u.roleCode!=='owner'&&!u.assistantCustomerOnly&&u.roleCode!=='personal-assistant').map(u=>({employeeId:u.id,name:u.name,rule:currentRule(store,p.skuId,c.now(),u.id)})),
      })),
    pending: store.commissionEntries
      .filter((e) => ['sale','business','carrier_rebate'].includes(e.kind) && e.amount == null)
      .map(({ profit, ...e }) => ({
        ...e,
        employeeName:
          store.users.find((u) => u.id === e.employeeId)?.name || "",
      })),
  };
}
function confirm(store, user, payload) {
  c.permit(user, "confirmPay");
  const targetMonth = c.validMonth(payload.month);
  if (targetMonth >= c.month())
    throw new c.HttpError(409, "月份结束后才能确认工资");
  const employee = store.users.find((u) => u.id === payload.employeeId);
  if (!employee) throw new c.HttpError(404, "员工不存在");
  const row = wageRow(store, employee, targetMonth);
  if (row.status !== "draft") return row;
  if (row.total == null) throw new c.HttpError(409, "请先补齐底薪和待核算提成");
  const result = {
    ...row,
    id: c.id("PAY"),
    status: "confirmed",
    confirmedAt: c.now(),
    confirmedBy: user.id,
  };
  store.payrollStatements.push(result);
  c.audit(
    store,
    user,
    "payroll:confirm",
    `确认 ${employee.name} ${targetMonth} 工资`,
  );
  return result;
}
function markPaid(store, user, payload) {
  c.permit(user, "confirmPay");
  const row = store.payrollStatements.find((p) => p.id === payload.statementId);
  if (!row) throw new c.HttpError(404, "请先确认工资");
  if (row.status === "paid") return row;
  if (row.total < 0)
    throw new c.HttpError(409, "应发金额为负，请先核对提成调整");
  const pa=require("./payment-accounts"),parts=pa.normalize(store,payload,row.total,"银行卡"),account=parts.length===1?parts[0].account:parts.length?"多账户":"无需付款";
  Object.assign(row, {
    status: "paid",
    paidAt: c.now(),
    paidBy: user.id,
    paymentParts:parts,
    account,
  });
  pa.record(store,user,"payroll",row.id,parts,-1);
  c.audit(
    store,
    user,
    "payroll:paid",
    `记录 ${row.month} 工资发放 ${row.name}`,
  );
  return row;
}
module.exports = {
  saveRule,
  saveSalary,
  currentRule,
  accrue,
  accrueBusiness,
  ensureBusinessEntry,
  giftAdjustment,
  reverse,
  resolveEntry,
  getPayroll,
  settings,
  confirm,
  markPaid,
  saveAdjustment,
  accrueBusiness,
  ensureBusinessEntry,
  carrierRate,
  accrueCarrierReceipt,
};
