'use strict';
const c=require('./common'),social=require('./assistant-social'),products=require('./assistant-product-query'),tariffs=require('./assistant-tariff-query'),dialogue=require('./assistant-dialogue'),talk=require('./customer-talk-query');
const internal=/门店微信|老板微信|老板支付宝|门店现金|信号机微信|空充|BOSS|资金账户|资金收支|资金流水|财务流水|收支流水|交接班|现金交接|现金交款|上传学习资料|毛利|利润|成本|进价|采购价|拿货价|工资|底薪|提成|酬金|佣金|积分|奖励|红包|出勤|考勤|签到|签退|营业额|销量|账套|流水|进货|供应商|供货商|应收|应付|员工情况|员工动态|员工工作|老板简报|店内情况|店里情况|银行|银行卡账户|收款账户|串号|串码|imei|仓库|库存|销售记录|单号|订单|客户档案|客户手机号|备份|还原|导出|审批|待办|待审核|权限|口令|密码|今天.*(?:卖|收|赚|进|办了)|采购|红冲|开单|销售单|接待单|调价|改价|删除|清空/i;
const privateAnswer=dialogue.privateWords;
const productCreate=require('./assistant-product-create');
const policy=require('./policy-knowledge-query');
function response(text,style,extra={}){return {answer:text,asOf:c.now(),scope:'顾客咨询',sources:[],metrics:{kind:'customer-dialogue',replyStyle:style},...extra};}
function tariffPublic(raw,style){
 if(!raw)return null;
 const safe=raw.metrics?.needsClarification||raw.metrics?.noVerifiedMatch||raw.metrics?.international;
 const rows=(raw.tariffOptions||raw.tariffCatalog?.rows||[]).map(row=>({planName:row.planName+(row.variant||''),family:row.family,baseMonthlyFee:row.baseMonthlyFee,minutes:row.minutes,domesticGB:row.domesticGB,domesticFlowLabel:row.domesticFlowLabel,chongqingGB:row.chongqingGB,directedGB:row.directedGB,unspecifiedGB:row.unspecifiedGB,exclusiveFlowText:row.exclusiveFlowText,broadband:row.broadband,subcards:row.subcards,commitment:row.commitment,status:row.status==='current'?'现行参考，资格及总费另核':'待核实'}));
 let answer=safe?raw.answer:raw.metrics?.catalog?'已列出套餐基础月费、通话分钟和各范围流量，具体资格及实际总费请营业员核对。':raw.answer;
 if(privateAnswer.test(answer))answer='请营业员核对当前资费和办理条件，再为你推荐。';
 return response(answer,style,{conversationHint:raw.conversationHint,followups:raw.followups||[],metrics:{kind:'tariff-recommendations',replyStyle:style,referenceOnly:true,needsClarification:!!raw.metrics?.needsClarification},...(rows.length?{table:{title:'套餐参考（基础费，实际总费另核）',columns:[{key:'planName',label:'套餐'},{key:'baseMonthlyFee',label:'基础月费'},{key:'minutes',label:'通话（分钟/月）'},{key:'domesticGB',label:'全国/通用流量（GB/月）'},{key:'chongqingGB',label:'重庆流量（GB/月）'},{key:'directedGB',label:'定向流量（GB/月）'},{key:'unspecifiedGB',label:'范围待核流量（GB/月）'},{key:'status',label:'资料状态'}],rows}}:{})});
}
function promotionAnswer(result,items){
 if(!result.sections?.length||result.metrics?.needsReview||result.metrics?.needsClarification)return result.answer;
 const pieces=result.sections.flatMap(section=>{
  const fee=section.headers.findIndex(header=>/资费|月费|月租/.test(header)),contract=section.headers.findIndex(header=>/合约/.test(header)),benefit=section.headers.findIndex(header=>/权益|产品内容/.test(header));
  if(fee<0)return [];
  return section.rows.map(row=>String(row[0])+'，每月'+row[fee]+'元'+(contract>=0?'，合约'+row[contract]+(/月/.test(row[contract])?'':'个月'):'')+'。'+(benefit>=0?'包含'+String(row[benefit]).replace(/[。；;\s]+$/,'')+'。':''));
 });
 if(!pieces.length)return result.answer;
 const item=items.find(row=>row.id===result.metrics.articleId);
 if(item?.id==='mobile-promotions-20261010-ai-care')pieces.push('这项优惠适用于指定全光产品；选择双目室外机需另付100元调测费。');
 return pieces.join('\n')+'\n可以先按这些资费参考，具体办理由营业员帮你核对。';
}
function query(store,user,payload){
 c.permit(user,'learn');const q=require('./assistant-language').normalize(c.text(payload.question,'问题'),{customer:true}),style=payload.customerReplyStyle==='mandarin'?'mandarin':'sichuan';
 // Customer mode never falls through to the ledger assistant or general search.
 if(internal.test(q)||privateAnswer.test(q)||productCreate.isRequest(q))return response(style==='sichuan'?'这项由店员在店内模式核对哈。你要咨询商品还是办理业务嘛？':'这项请店员在店内模式核对。您需要咨询商品还是办理业务？',style,{metrics:{kind:'customer-dialogue',replyStyle:style,restricted:true}});
 const entry=dialogue.find(store,q,{customer:true,answered:payload.dialogueAnswered||[],pool:payload.dialoguePool});
 if(entry&&!entry.slot&&!privateAnswer.test(entry.answer)&&!privateAnswer.test(entry.answerMandarin||'')){const raw=dialogue.manual(entry,style);return response(raw.answer,style,{metrics:raw.metrics,...(payload.tariffProfile?{conversationHint:{topic:'tariff-recommendations',profile:payload.tariffProfile,awaiting:payload.tariffAwaiting,dialogueAnswered:payload.dialogueAnswered,dialoguePool:payload.dialoguePool}}:{})});}
 // Only explicitly public cards from this dated promotion batch enter customer consultation.
 // policy.query checks effective dates, so expired offers never fall through to external chat.
 const publicBlockIds={
  'mobile-promotions-20261010-ai-care':['activity-period','products','fee-contract','extra-fee'],
  'mobile-promotions-20261010-screen-upgrade':['activity-period','activity','benefit'],
  'mobile-promotions-20261010-screen-fees':['activity-period','tariffs']
 };
 const publicPromotions=(store.employeeKnowledge||[]).filter(row=>row.importBatch==='mobile-promotions-20261010'&&row.customerVisible===true&&row.sourceTier==='store_policy'&&publicBlockIds[row.id]&&!row.sourceRevisionNote&&!row.editedAfterImport).map(row=>{
  const sourceBlocks=(row.sourceBlocks||[]).filter(block=>publicBlockIds[row.id].includes(block.id)&&!privateAnswer.test(block.text||'')).map(block=>block.id==='activity-period'?{...block,text:'促销有效期：'+row.validFrom+' 至 '+row.validTo+'；产品合约期另计。'}:block);
  return {...row,publicConsultation:true,body:sourceBlocks.map(block=>block.text).join('\n'),sourceBlocks,summary:'',applicableScope:'仅限所列产品，促销有效日期和合约期分别核对。',sourceRefs:[]};
 }).filter(row=>row.sourceBlocks.length&&!privateAnswer.test(row.title||''));
 const promotion=policy.query(store,user,q,publicPromotions);
 if(promotion&&!privateAnswer.test(promotion.answer))return response(promotionAnswer(promotion,publicPromotions),style,{metrics:{...promotion.metrics,replyStyle:style},sources:publicPromotions.filter(row=>row.id===promotion.metrics.articleId||(promotion.metrics.articleIds||[]).includes(row.id)).map(row=>({id:row.id,label:row.title,href:'/assistant'})),...(promotion.table?{table:promotion.table}:{})});
 const canonical=entry?.slot==='social:greeting'?'你好':entry?.slot?.startsWith('tariff:')?'我想办张手机卡':q;
 let raw=social.query(store,user,canonical,{customerReplyStyle:style});
 if(raw){
  if(raw.metrics.topic==='working')raw={...raw,answer:style==='sichuan'?'我在这儿等你喊我呀。可以陪你简单摆两句，也能帮你看看套餐、宽带，有啥子想问的嘛？':'我在这里等您找我。可以简短聊聊，也能帮您了解套餐和宽带，您想问什么？'};
  if(raw.metrics.topic==='capabilities')raw={...raw,answer:style==='sichuan'?'我可以帮你选商品、看套餐，了解办卡、宽带和维修。你要办啥子嘛？':'我可以帮您选商品、看套餐，了解办卡、宽带和维修。您需要什么？'};
  if(['identity','employer'].includes(raw.metrics.topic))raw={...raw,answer:style==='sichuan'?'我是小猫咪机器人，帮你解答移动业务问题，也可以简单摆两句哈。':'我是小猫咪机器人，帮助您解答移动业务问题，也可以简短聊天。'};
  raw=dialogue.customize(store,raw,style,{customer:true,answered:payload.dialogueAnswered||[],pool:payload.dialoguePool});
  return response(raw.answer,style,{metrics:{kind:'assistant-social',topic:raw.metrics.topic,replyStyle:style,...(raw.metrics.dialogueId?{dialogueId:raw.metrics.dialogueId,dialogueVersion:raw.metrics.dialogueVersion}:{})},...(raw.conversationHint?{conversationHint:raw.conversationHint}:{}),followups:raw.followups||[]});
 }
 raw=products.query(store,{...user,assistantCustomerOnly:false,roleCode:'employee',permissions:['sale:create']},q,{customerReplyStyle:style});
 if(raw){const rows=(raw.metrics.recommendations||[]).map(row=>({name:row.name,salePrice:row.salePrice}));return response(rows.length?rows.map(row=>row.name+'，零售价'+row.salePrice+'元').join('；')+'。你想看哪款嘛？':'请营业员帮你核对现货和零售价。',style,{metrics:{kind:'product-recommendations',replyStyle:style},...(rows.length?{table:{title:'商品零售价',columns:[{key:'name',label:'商品'},{key:'salePrice',label:'零售价'}],rows}}:{})});}
 raw=tariffs.query(store,user,canonical,{customerReplyStyle:style,profile:payload.tariffProfile,awaiting:payload.tariffAwaiting});
 if(raw)return tariffPublic(dialogue.customize(store,raw,style,{customer:true,answered:payload.dialogueAnswered||[],pool:payload.dialoguePool}),style);
 // Named tariff questions use the same real structured source, with a public field projection.
 if(/套餐|巴渝卡|校园|青春卡|飞享|全家享|数字家庭|5ga/i.test(q)&&/资费|多少钱|月租|月费|流量|分钟|收费|套餐外|超套|超出|超额/i.test(q)){
  const name=q.match(/4G飞享|巴渝卡|校园|青春卡|飞享|全家享|数字家庭|5ga/i)?.[0],fee=q.match(/(\d+)\s*元/);
  const rows=tariffs.catalog(store,user).rows.filter(row=>(!name||row.planName.toLowerCase().includes(name.toLowerCase()))&&(!fee||row.baseMonthlyFee===Number(fee[1])));
  if(/套餐外|超套|超出|超额/.test(q)){
    if(rows.length!==1||rows[0].status!=='current')return response('请营业员核对具体套餐版本和套餐外收费，我先不作确定报价。',style);
    const onlyVoice=/分钟|通话|电话/.test(q)&&!/流量|GB/i.test(q),onlyData=/流量|GB/i.test(q)&&!/分钟|通话|电话/.test(q);
    const charges=(rows[0].conditions||[]).filter(text=>!privateAnswer.test(text)&&(/套餐外/.test(text)||/超套|超出|超额/.test(text)&&/收费|计费|元|GB/i.test(text))&&(!onlyVoice||/分钟|通话|电话/.test(text))&&(!onlyData||/流量|GB/i.test(text)));
    return response(charges.length?charges.join('；'):'这份资料未列明对应的套餐外收费，请营业员核对。',style);
  }
  return rows.length?tariffPublic({answer:'这是已录入资料中的套餐基础档，具体资格及总费用由营业员核对。',tariffOptions:rows.slice(0,12),metrics:{}},style):response('这项资费还需要营业员核对，我先不作确定报价。',style);
 }
 // Serve only current, non-private consultation summaries; never the raw staff knowledge body.
 const cards=(store.employeeKnowledge||[]).filter(row=>dialogue.canAnswerKnowledge(store,row.id,true)&&row.policyStatus==='current'&&!row.sourceRevisionNote&&!privateAnswer.test(row.summary||'')&&!privateAnswer.test(row.summaryDialect||''));
 raw=talk.query(store,user,q,cards,{customerReplyStyle:style});if(raw)raw=dialogue.customize(store,raw,style,{customer:true,answered:payload.dialogueAnswered||[],pool:payload.dialoguePool});
 if(raw&&!raw.metrics?.originalRequested&&!raw.metrics?.automaticGuidancePaused&&!raw.metrics?.needsReview&&!privateAnswer.test(raw.answer))return response(raw.answer,style,{metrics:{kind:'customer-talk-guidance',replyStyle:style,referenceOnly:true}});
 return response(style==='sichuan'?'你是想买商品、办卡、充值，还是办宽带嘛？不确定的业务，请营业员当面帮你核对。':'您想购买商品、办卡、充值还是办理宽带？不确定的业务请营业员当面核对。',style,{unresolved:true,followups:[{label:'办卡',question:'我想办张手机卡'}]});
}
module.exports={query};
