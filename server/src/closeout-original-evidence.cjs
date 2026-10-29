'use strict';

// Read-only evidence projection. Never infer a person's omission from a field
// that was absent from the form used to submit the original record.
const day = value => String(value || '').slice(0, 10);
const previousDay = today => new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
const money = value => value == null ? '未记录' : Number(value).toFixed(2) + ' 元';
const time = value => value ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（北京时间）' : '未记录';
const sentence = value => /[。！？；]$/.test(String(value||'')) ? String(value) : String(value||'无')+'。';

function isQuestion(question) {
  return /扎账|报数|清点/.test(question) && /BOSS|博士|空充|余额|漏填|没填|未填|原单/.test(question);
}

function answer(store, user, question, today) {
  if (!isQuestion(question)) return null;
  const documentNo=(String(question).match(/ZZ-\d{8}-\d+/i)||[])[0];
  const encodedDay=documentNo?.match(/-(20\d{2})(\d{2})(\d{2})-/);
  const date = (String(question).match(/20\d{2}-\d{2}-\d{2}/) || [])[0]
    || (encodedDay ? encodedDay[1]+'-'+encodedDay[2]+'-'+encodedDay[3] : null)
    || (/昨天|昨日/.test(question) ? previousDay(today) : /今天|当日/.test(question) ? today : null);
  if (!date) return {answer:'请提供营业日或扎账单号，我会按提交时的原单核对，不能凭当前核对页判断员工是否漏填。',unresolved:true,sources:[]};
  const people = (store.users || []).filter(person => person.name && question.includes(person.name));
  const named = people.sort((a,b) => b.name.length - a.name.length)[0];
  const visible = (store.dailyCloseouts || []).filter(row => row.date === date &&
    (user.roleCode === 'owner' || [row.cashierId,row.reviewerId,row.actualCounterId].includes(user.id)) &&
    (!named || [row.cashierId,row.actualCounterId].includes(named.id)));
  const selected = visible.filter(row => (!documentNo || row.displayNo?.toUpperCase() === documentNo.toUpperCase()) &&
    (!/晚|晚上|夜/.test(question) || row.simpleStage === 'evening' || row.recordType === 'formal'));
  if (!selected.length) return {answer:date+' 当前账号没有匹配的可见扎账原单；不能据此认定任何人未报数。',unresolved:true,sources:[]};
  if (selected.length > 5) return {answer:date+' 匹配的扎账原单超过 5 张，请提供单号或时段逐张核对，不能混用不同单据。',unresolved:true,sources:[{label:'当日扎账查询',href:'/daily-close?view=history'}]};
  const lines=selected.map(row => {
    const id=row.displayNo||row.id;
    if (row.simpleDailyClose === true) {
      const reporter=row.ownerRecorded ? '记录的实际报数人 '+(row.actualCounterName||'未记录')+'；代录人 '+(row.recordedByName||row.cashier||'未记录') : '提交人 '+(row.cashier||'未记录');
      if(row.sourceFormVersion==='simple-four-items-v1'){
        const fields='现金实点 '+money(row.actualCash)+'，空充BOSS实看 '+money(row.simpleAirActualBalance)+'，门店微信实看 '+money(row.walletActualBalance)+'，非现金实报 '+money(row.simpleNoncashActual);
        const basis='现金账面 '+money(row.expectedCash)+'，空充BOSS系统期末 '+money(row.simpleAirSystem)+'，门店微信账面 '+money(row.simpleWalletSystem)+'，非现金系统统计 '+money(row.simpleNoncashSystem);
        const finding='原单实际报数：'+fields+'。系统依据：'+basis+'。提交说明原文：'+sentence(row.note)+'各项差额须按原单和平台账户分别核实；报数不等于到账或老板审核。';
        return user.roleCode==='owner'?'核查报告 · '+id+'\n'+reporter+'；提交时间 '+time(row.submittedAt)+'。'+finding:id+' 原单查询：'+reporter+'；提交时间 '+time(row.submittedAt)+'。'+finding;
      }
      if(user.roleCode!=='owner')return id+' 原单查询：简易'+(row.simpleStage==='evening'?'晚间报数':'现金清点')+'；'+reporter+'；提交时间 '+time(row.submittedAt)+'；提交说明原文：'+sentence(row.note)+'该版原单没有 BOSS 余额独立实报栏。如需核对平台实际余额，请由有权查看该账户的人员办理。';
      return '核查报告 · '+id+'\n原单事实：简易'+(row.simpleStage==='evening'?'晚间报数':'现金清点')+'，'+reporter+'，提交时间 '+time(row.submittedAt)+'。该版原单只采集现金实点'+(row.simpleStage==='evening'?'、门店微信实看余额、非现金收款实报':'')+'和说明，没有 BOSS 余额独立实报栏。提交说明原文：'+sentence(row.note)+'\n系统依据：空充期末 '+money((row.snapshot?.mobile||[]).find(item=>item.key==='airClosing')?.own)+'，属于账面核对依据，不能当成报数人填写。\n原因：若查询页把此单的 BOSS 独立栏显示为“未填”，原因是详细核对字段被套在简易原单上；两项没有可比的员工填报值。\n结论：现有原单不能证明报数人本人核实过 BOSS 余额，也不能凭空栏认定其漏报。\n待核：由实际报数人及平台账户持有人分别核实说明中数字的来源与平台实际余额；本报告只读生成，尚未写入 ERP 核查待办。';
    }
    const air=(row.snapshot?.mobile||[]).find(item=>item.key==='airClosing');
    if(user.roleCode!=='owner')return id+' 原单查询：详细扎账；提交人 '+(row.cashier||'未记录')+'；提交时间 '+time(row.submittedAt)+'；原单 BOSS 期末填报 '+(air?.boss==null?'该栏无值':money(air.boss))+'。后续核对结果以原单记录为准。';
    return '核查报告 · '+id+'\n原单事实：详细扎账，提交人 '+(row.cashier||'未记录')+'，提交时间 '+time(row.submittedAt)+'；原单保存的 BOSS 期末填报 '+(air?.boss==null?'该栏无值':money(air.boss))+'。\n系统依据：账面期末 '+money(air?.own)+'。\n原因：仅凭本次字段不能确定空值或差额原因，须连同提交、补正和复核记录核查。\n结论：单一空值不能直接归责。\n待核：由提交人、复核人及平台账户持有人分别核查；本报告只读生成，尚未写入 ERP 核查待办。';
  });
  return {answer:lines.join('\n'),unresolved:true,sources:selected.map(row=>({label:'扎账原单 '+(row.displayNo||row.id),href:row.simpleDailyClose===true?'/simple-daily-close?view=reports&reviewDate='+encodeURIComponent(row.date)+'&record='+encodeURIComponent(row.id):'/daily-close?closeout='+encodeURIComponent(row.id)}))};
}

module.exports={answer,isQuestion};
