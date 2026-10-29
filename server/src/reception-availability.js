'use strict';
const c=require('./common');
const enabled=false;
const message='该功能已停用，请返回工作台。';
const receptionPath=value=>/^\/receptions(?:[?#/]|$)/.test(String(value||''));
function assertEnabled(){if(!enabled)throw new c.HttpError(410,message);}
function answer(question){if(!/(?:语音接待|接待单|接菜单|接待记录|接待跟进|接待工单|接待功能|接待积分|接待情况|接待质量|加微信.*积分|协助.*积分|成交归属)/.test(String(question||'')))return null;return {answer:'当前没有这项功能。销售、充值、维修和移动业务可从各自入口办理。',mode:'store',sources:[],followups:[],unresolved:false,action:null,metrics:{kind:'reception-disabled',modelCalls:0,ruleVersion:'reception-suspended-v1'}};}
function notice(store,row){const id=String(row.orderId||''),key=String(row.key||'');return (store.receptions||[]).some(r=>r.id===id||(r.assists||[]).some(a=>a.id===id))||(store.conversionClaims||[]).some(r=>r.id===id)||/^(?:reception|assist|wechat|conversion)(?:[-:]|$)/.test(key);}
function wrap(api){const result={...api,list:(store,user)=>{c.permit(user,'sell');return {rules:api.settings(store),rows:[],enabled:false,message};}};for(const name of ['create','update','supplement','claimWechat','confirmWechat','addFollowUp','confirmFollowUp','reviewInvalidQuality','addAssist','confirmAssist','link','linkExisting','close','confirmClose','saveRules','allocateCommission','assistantDraft'])result[name]=assertEnabled;return result;}
module.exports={enabled,message,receptionPath,assertEnabled,answer,notice,wrap};
