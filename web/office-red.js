async function renderRedPanel(){
 const current=officePageCurrent('red');
 const focusId=new URLSearchParams(location.search).get('focusRed')||'';
 const requests=await officePageRead(current,()=>api('/api/red-reversals'));
 if(!current())return;
 const selected=focusId?requests.filter(r=>r.id===focusId):requests.filter(r=>documentMatches(r));
 if(focusId&&!selected.length){$('main').insertAdjacentHTML('beforeend','<section class="card"><h2>这张红冲申请未找到</h2><p>原申请可能已不可见或编号不正确，请返回全部红冲记录核对。</p><a href="/app?tab=red">返回全部红冲记录 ›</a></section>');return;}
 const pending=new Set(requests.filter(r=>r.status==='待老板审核').map(r=>r.sourceId||r.expenseId));
 const sources=focusId?[]:await officePageRead(current,()=>api('/api/red-reversals/sources'));
 if(!current())return;
 const names={expense:'费用付款',other_income:'其他收入',sale:'销售单'};
 const sourceRows=sources.filter(r=>documentMatches(r)).slice().reverse().map(r=>'<tr><td data-label="原单">'+E(documentNo(r))+'<small>'+E(names[r.kind]+' · '+r.title)+'</small></td><td data-label="金额">'+M(r.amount)+'</td><td data-label="状态">'+E(r.redReversedBy?'已红冲':pending.has(r.id)?'待老板审核':'原单有效')+'</td><td data-label="操作">'+redPacketEntry(({sale:'sales',expense:'expenses',otherIncome:'otherIncome',other_income:'otherIncome'})[r.kind]||'',r)+(state.user.capabilities.redRequest&&!r.redReversedBy&&!pending.has(r.id)?button('申请红冲','red-request',JSON.stringify({kind:r.kind,sourceId:r.id})):'')+'</td></tr>');
 const requestRows=selected.map(r=>'<tr><td data-label="申请号">'+E(documentNo(r))+'<small>原单 '+E(r.sourceDisplayNo||r.expenseDisplayNo||r.sourceId||r.expenseId)+'</small></td><td data-label="金额">'+M(r.amount)+'</td><td data-label="原因">'+E(r.reason)+'</td><td data-label="状态">'+E(r.status)+'</td><td data-label="操作">'+redPacketEntry('redReversals',r)+(state.user.roleCode==='owner'&&state.user.capabilities.redReview&&r.status==='待老板审核'?button('通过并红冲','red-approve',r.id)+button('驳回','red-reject',r.id):'')+'</td></tr>');
 $('main').insertAdjacentHTML('beforeend','<section class="card mobile-record-list">'+(focusId?'<p><a href="/app?tab=red">返回全部红冲记录 ›</a></p>':'<h2>原单查询</h2><p>换货新单含原单抵款，请到<a href="/app?tab=returns">退换货</a>办理退货。</p>'+table(['原单','金额','状态','操作'],sourceRows))+'<h2>'+(focusId?'这张红冲申请':'申请与审核记录')+'</h2>'+table(['申请号','金额','原因','状态','操作'],requestRows)+'</section>');
}
async function renderRedReversals(){const focused=new URLSearchParams(location.search).has('focusRed');$('main').innerHTML=heading(focused?'只看这张红冲申请':'单据红冲','用于销售单、费用付款和其他收入的误记更正。员工可以提交申请，只有老板本人批准后才生成反向记录，原单保留，销售库存和提成同步恢复。实际退货、退款和采购退货从对应业务办理。已退换货、含赠品耗材或国补的销售单须先核实原业务。',button('刷新','refresh'))+(focused?'':documentFilter('red-filter'));if(!focused)bindDocumentFilter('red-filter',renderRedReversals);await renderRedPanel();}
function requestExpenseRed(value){
 let data;try{data=JSON.parse(value)}catch{data={kind:'expense',expenseId:value}}
 modal('申请原单红冲',[{name:'reason',label:'误记原因',type:'textarea',wide:true,required:true,hint:'至少8字。确认原记录属于误记；实际退款请办理退货或退款。'}],(d,write)=>write('/api/red-reversals',{...data,reason:d.reason}));
}
function reviewExpenseRed(id,decision){if(state.user.roleCode!=='owner')return toast('红冲必须由老板本人批准',true);modal(decision==='approve'?'审核并红冲':'驳回红冲',[{name:'note',label:'审核意见',type:'textarea',wide:true,required:true,hint:'至少4字，记录核实依据。'}],(d,write)=>write('/api/red-reversals/review',{id,decision,note:d.note}));}
