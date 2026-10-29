(function(root){'use strict';
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money=v=>'¥'+Number(v).toFixed(2);
let catalog=null,control=null,form=null;
function months(day,terms=4){if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))return [];const [y,m]=day.slice(0,7).split('-').map(Number);return Array.from({length:terms},(_,i)=>new Date(Date.UTC(y,m+i,1)).toISOString().slice(0,7));}
function summary(product,day){
 if(!product)return '<p>请选择实际办理的具体产品；清单未列明的业务，酬金保留待核。</p>';
 const period=months(day,product.terms);
 return '<section class="commission-product-summary"><strong>'+E(product.name)+'</strong><p>预计总酬金 <b>'+money(product.expectedTotal)+'</b></p><p>'+(product.terms===4?'办理次月起，每期 '+money(product.periodAmount)+'，共4期':'办理次月一次性返清 '+money(product.expectedTotal))+'</p>'+(period.length?'<div class="source-table-scroll"><table><thead><tr><th>预计返还月份</th><th>预计酬金</th></tr></thead><tbody>'+period.map(month=>'<tr><td>'+E(month)+'</td><td>'+money(product.periodAmount)+'</td></tr>').join('')+'</tbody></table></div>':'<p>选择办理日期后显示预计返还月份。</p>')+'<p class="hint">这是预计基础酬金；移动结算单确认与实际到账分别登记。来源：'+E(product.sourceName||catalog?.sourceName||'10月20日更新清单')+' · '+E(product.sourceRange)+'</p></section>';
}
function mount(target){form=target;if(form.elements.commissionProductId){control=form.elements.commissionProductId;return;}const label=document.createElement('label');label.id='commission-product-field';label.hidden=true;label.append(document.createTextNode('已办具体产品／档位'));control=document.createElement('select');control.name='commissionProductId';control.addEventListener('change',()=>form.dispatchEvent(new CustomEvent('commission-product-change')));label.append(control);form.elements.subType.closest('label').after(label);}
function sync(basis){if(!control)return;const show=basis==='other';control.closest('label').hidden=!show;control.disabled=!show;control.required=show;if(!show)control.value='';}
function install(data){catalog=data;const saved=control?.value||'';if(control){control.replaceChildren(new Option('请选择实际办理的产品',''),...data.products.map(p=>new Option(p.name+' · 预计酬金 '+money(p.expectedTotal),p.id)),new Option('清单未列明此业务（酬金待核）','__unlisted__'));control.options[0].disabled=true;control.value=saved;}}
function selected(){return catalog?.products.find(p=>p.id===control?.value)||null;}
function render(basis,day){sync(basis);if(basis!=='other')return false;document.getElementById('commission-plan').innerHTML=catalog?summary(selected(),day):'<p>正在读取具体产品酬金标准…</p>';return true;}
root.CarrierCommissionProducts={mount,install,render,summary,months};
})(window);
