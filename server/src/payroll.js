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
function currentRule(store, skuId, at = c.now()) {
  return (
    store.commissionRules
      .filter((r) => r.skuId === skuId && r.effectiveAt <= at)
      .sort((a, b) => b.sequence - a.sequence)[0] || null
  );
}
function saveRule(store, user, payload) {
  c.permit(user, "managePay");
  if (!store.products.some((p) => p.skuId === payload.skuId))
    throw new c.HttpError(404, "商品不存在");
  const rule = {
    id: c.id("RULE"),
    skuId: payload.skuId,
    ...validateRule(payload),
    effectiveAt: c.now(),
    sequence: store.commissionRules.length + 1,
    operatorId: user.id,
  };
  store.commissionRules.push(rule);
  c.audit(store, user, "commission:rule", `设置 ${payload.skuId} 提成`);
  return rule;
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
  const rule = currentRule(store, item.skuId, order.createdAt);
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
) {
  const original = store.commissionEntries.find(
    (e) => e.itemId === item.id && e.kind === "sale",
  );
  if (!original) return;
  const previous = store.commissionEntries
    .filter((e) => e.originalId === original.id && e.kind === "return")
    .reduce((n, e) => n + Number(e.amount || 0), 0);
  const amount =
    original.amount == null
      ? null
      : c.round(
          -c.round((original.amount * totalReturnedQty) / item.quantity) -
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
    profit: -c.round((item.profit * returnedQty) / item.quantity),
    amount,
    month: c.month(at),
    createdAt: at,
  });
}
function resolveEntry(store, user, entryId, payload) {
  c.permit(user, "managePay");
  const entry = store.commissionEntries.find(
    (e) => e.id === entryId && e.kind === "sale",
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
  Object.assign(entry, rule, {
    amount: calculate(rule, entry),
    resolvedBy: user.id,
    resolvedAt: c.now(),
  });
  let reversed = 0;
  for (const adjustment of linked) {
    const cumulative = c.round(
      (entry.amount * adjustment.cumulativeQuantity) / entry.quantity,
    );
    Object.assign(adjustment, rule, {
      amount: c.round(-(cumulative - reversed)),
    });
    reversed = cumulative;
  }
  if (rule.mode === "profit") {
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
  return {...publicFields(row,["id","employeeId","orderId","itemId","productName","quantity","createdAt","kind","mode","value","ruleId","month","reason","originalId","returnId","giftId","assistId","resolvedAt","resolvedBy"]),
    employeeName:employeeName(store,row.employeeId),orderNo:orderNo(store,row.orderId),
    date:row.createdAt?c.day(row.createdAt):"",amount:knownAmount(row)?Number(row.amount):null,status:knownAmount(row)?"accrued":"pending"};
}
function publicAdjustment(store,row) {
  return {...publicFields(row,["id","employeeId","month","direction","amount","signedAmount","reason","sourceOrderId","originalStatementId","createdAt","operatorId","operatorName"]),
    employeeName:employeeName(store,row.employeeId),orderNo:orderNo(store,row.sourceOrderId)};
}
function businessChecks(store,employeeId,targetMonth) {
  const entries=store.commissionEntries.filter(row=>row.employeeId===employeeId&&row.month===targetMonth&&row.kind==="sale"),result=[];
  for(const order of store.sales){
    if((order.salespersonId||order.operatorId)!==employeeId||c.month(order.createdAt)!==targetMonth)continue;
    for(const item of order.items||[]){
      const matched=entries.filter(row=>row.orderId===order.id&&row.itemId===item.id);
      const status=!matched.length?"missing":matched.some(row=>!knownAmount(row))?"pending":"accrued";
      result.push({employeeId,employeeName:employeeName(store,employeeId),orderId:order.id,orderNo:orderNo(store,order.id),itemId:item.id,
        productName:item.name,quantity:item.quantity,date:c.day(order.createdAt),createdAt:order.createdAt,status,
        amount:status==="accrued"?c.round(matched.reduce((sum,row)=>sum+Number(row.amount),0)):null,entryIds:matched.map(row=>row.id)});
    }
  }
  return result;
}
function pointsFor(store,id,targetMonth) {
  if(!id)return [];
  const rows=[];
  const add=(sourceId,type,label,at,points,pointId)=>{if(at&&c.month(at)===targetMonth)rows.push({id:pointId||sourceId,employeeId:id,employeeName:employeeName(store,id),sourceId,sourceType:type,kind:label,points:Number(points||0),createdAt:at,date:c.day(at),status:"confirmed"});};
  for(const reception of store.receptions||[])for(const point of reception.points||[])if(point.employeeId===id&&point.confirmedBy)add(reception.id,"reception",point.kind,point.at,point.amount,point.id);
  for(const record of store.learningRecords||[])if(record.employeeId===id&&record.status==="已通过"&&record.reviewedBy)add(record.id,"learning",record.event||"学习单",record.reviewedAt,record.points);
  for(const record of store.workJournals||[])if(record.employeeId===id&&record.status==="已核定"&&record.reviewedBy)add(record.id,"work-journal",record.event||"工作日志",record.reviewedAt,record.points);
  return rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
function wageRow(store, employee, targetMonth) {
  const saved = store.payrollStatements.find(
    (p) => p.employeeId === employee.id && p.month === targetMonth,
  );
  if (saved) return { ...saved, manualAdjustment:saved.manualAdjustment || 0, manualAdd:saved.manualAdd || 0, manualDeduct:saved.manualDeduct || 0, missing:saved.missing || 0, name: employee.name, role: employee.role };
  const salary = salaryAt(store, employee.id, targetMonth);
  const entries = store.commissionEntries.filter(
    (e) => e.employeeId === employee.id && e.month === targetMonth,
  );
  const piece = c.round(
    entries
      .filter((e) => e.kind === "sale" && e.mode === "piece")
      .reduce((s, e) => s + Number(e.amount || 0), 0),
  );
  const profit = c.round(
    entries
      .filter((e) => e.kind === "sale" && e.mode === "profit")
      .reduce((s, e) => s + Number(e.amount || 0), 0),
  );
  const adjustment = c.round(
    entries
      .filter((e) => e.kind === "return" || e.kind === "assist_transfer" || e.kind === "gift")
      .reduce((s, e) => s + Number(e.amount || 0), 0),
  );
  const pending = entries.filter((e) => e.amount == null).length;
  const commission = c.round(piece + profit + adjustment);
  const missing = businessChecks(store,employee.id,targetMonth).filter(row=>row.status === "missing").length;
  const manualRows = (store.payrollAdjustments || []).filter(row=>row.employeeId===employee.id && row.month===targetMonth);
  const manualAdd = c.round(manualRows.filter(row=>row.direction==="add").reduce((sum,row)=>sum+row.amount,0));
  const manualDeduct = c.round(manualRows.filter(row=>row.direction==="deduct").reduce((sum,row)=>sum+row.amount,0));
  const manualAdjustment = c.round(manualAdd-manualDeduct);
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
    pending,
    missing, manualAdd, manualDeduct, manualAdjustment,
    adjustmentIds:manualRows.map(row=>row.id),
    total: salary && !pending && !missing ? c.round(salary.amount + commission + manualAdjustment) : null,
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
        .map(e => publicEntry(store,e))
    : [];
  const checks=selected?businessChecks(store,selected,targetMonth):[];
  const adjustments=selected?(store.payrollAdjustments||[]).filter(row=>row.employeeId===selected&&row.month===targetMonth).map(row=>publicAdjustment(store,row)):[];
  const points=pointsFor(store,selected,targetMonth);
  return {
    month: targetMonth,
    rows,
    entries, adjustments, businessChecks:checks, points,
    canAdjust:caps.confirmPay,
    canViewAll: caps.viewAllPay,
    canManage: caps.managePay,
    canConfirm: caps.confirmPay && targetMonth < c.month(),
    totals: {
      baseSalary: c.round(
        rows.reduce((s, r) => s + Number(r.baseSalary || 0), 0),
      ),
      commission: c.round(rows.reduce((s, r) => s + r.commission, 0)),
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
      })),
    pending: store.commissionEntries
      .filter((e) => e.kind === "sale" && e.amount == null)
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
  giftAdjustment,
  reverse,
  resolveEntry,
  getPayroll,
  settings,
  confirm,
  markPaid,
  saveAdjustment,
};
