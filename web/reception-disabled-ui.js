(()=>{'use strict';
// Remove only reception controls. Historical payroll values and business records stay intact.
const style=document.createElement('style');style.textContent='a[href^="/receptions"],#prepare-reception,[data-reception-disabled],section:has(#reception-review-summary),dialog:has(#quality-form){display:none!important}';document.head.append(style);
function clean(){
 const prior=document.getElementById('continue-unfinished-work');if(prior&&/接待/.test(prior.textContent))prior.setAttribute('data-reception-disabled','1');
 document.querySelectorAll('a[href]').forEach(a=>{try{if(new URL(a.href,location.origin).pathname==='/receptions')a.hidden=true;}catch{}});
 document.querySelectorAll('[name="receptionId"],#receptionId,#reception-select').forEach(el=>{if(el.value)el.value='';const host=el.closest('label,.field');if(host)host.setAttribute('data-reception-disabled','1');else el.setAttribute('data-reception-disabled','1');});
 document.querySelectorAll('.entry-guide').forEach(n=>{if(n.querySelector('a[href^="/receptions"]'))n.setAttribute('data-reception-disabled','1');});
 document.querySelectorAll('#sale-review span').forEach(n=>{if(/^接待单：/.test(n.textContent))n.setAttribute('data-reception-disabled','1');});
 document.querySelectorAll('select option[value="reception"],select option[value="receptions"]').forEach(n=>n.remove());
}
let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;observer.disconnect();clean();observer.observe(document.body,{childList:true,subtree:true});});});
if(document.body){clean();observer.observe(document.body,{childList:true,subtree:true});}else document.addEventListener('DOMContentLoaded',()=>{clean();observer.observe(document.body,{childList:true,subtree:true});});
})();