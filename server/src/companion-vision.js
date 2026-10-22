 'use strict';
const c=require('./common'),roles=require('./assistant-roles'),photos=require('./stocktake-photo'),crypto=require('node:crypto');
const PATH='/api/companion/library/photo/recognize';
const MEDICINE_NOTICE='仅供参考，具体咨询医生或药师。识别结果不能作为服药依据；不要凭外观认药、随意加量或混用。中草药、散装药片须当面核实。';
function createClient({env=process.env,fetchImpl=globalThis.fetch}={}){
 // Separate credentials are preferred. The existing multimodal provider is reusable, never the text endpoint.
 const separate=Object.keys(env).some(k=>k.startsWith('COMPANION_VISION_'));
 const prefix=separate?'COMPANION_VISION_':'STOCKTAKE_VISION_';
 const mapped=Object.fromEntries(['ENABLED','URL','API_KEY','MODEL'].map(k=>['STOCKTAKE_VISION_'+k,env[prefix+k]]));
 const client=photos.createClient({env:mapped,fetchImpl});let provider='';try{provider=new URL(mapped.STOCKTAKE_VISION_URL).hostname;}catch{}
 return {...client,provider:()=>provider};
}
const defaultClient=createClient();
function status(client=defaultClient){return {configured:client.configured(),provider:client.configured()?client.provider?.()||'图片识别服务':'',confirmationRequired:true,voiceprintConfigured:false};}
function record(s,u,id){roles.permitPersonal(u);const r=(s.companionProfiles||[]).find(p=>p.userId===u.id)?.personalLibrary?.items.find(x=>x.id===id);if(!r?.photo)throw new c.HttpError(404,'这张私人照片不存在');return r;}
const digest=b=>crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex');
function previous(s,u,b,key){roles.permitPersonal(u);const old=(s.requestRecords||[]).find(r=>r.userId===u.id&&r.path===PATH&&r.key===key);if(old){if(old.digest!==digest(b))throw new c.HttpError(409,'识别请求已变化，请重新提交');return old.result;}return null;}
async function prepare(s,u,b,{client=defaultClient,readFile}={}){
 const r=record(s,u,b.id);
 if(b.consent!==true)throw new c.HttpError(400,'请先确认把这张照片发送给图片识别服务');
 if(!Number.isInteger(b.version)||b.version!==r.version||r.archived)throw new c.HttpError(409,'照片记录已经变化，请刷新后再识别');
 if(!client.configured())throw new c.HttpError(503,'图片模型尚未接通；照片已保存，可以先手工补写内容');
 if(typeof client.describeLife!=='function')throw new c.HttpError(503,'这个服务暂不支持生活照片识别');
 const bytes=await readFile(r.photo.hash);if(!bytes)throw new c.HttpError(404,'照片暂不可读，请稍后再试');
 const image=photos.image('data:'+r.photo.mime+';base64,'+Buffer.from(bytes).toString('base64'));
 if(image.hash!==r.photo.hash)throw new c.HttpError(409,'照片文件与记录不一致，请重新保存照片');
 const result=photos.parseLifePhoto(JSON.stringify(await client.describeLife(image.data,r.kind)));
 // Drug mode exposes OCR only; discard inferred treatment, identity and dose suggestions from the model.
 if(r.kind==='药品照片'){
  result.title='药品照片（待核实）';result.observations=[{text:'这里只帮助阅读照片上清楚的文字，尚未核实药品身份、真伪或是否适合本人。',photo:1,confidence:'low'}];
  result.uncertain=['照片不能确认药品真伪、保存状况或是否适合本人。','中草药、散装药片仅凭照片无法可靠确认，请带实物向医生或药师核实。'];
  if(!result.visibleText||/\[不清\]/.test(result.visibleText))result.uncertain.push('药名或说明看不清，请补拍包装正反面、说明书或咨询药师。');
  result.medicineNotice=MEDICINE_NOTICE;
 }
 return {id:r.id,photoHash:r.photo.hash,version:r.version,processedAt:c.now(),provider:client.provider?.()||'图片识别服务',result};
}
function commit(s,u,b,prepared,key){const old=previous(s,u,b,key);if(old)return old;
 const r=record(s,u,b.id);if(r.version!==prepared.version||r.photo.hash!==prepared.photoHash||r.archived)throw new c.HttpError(409,'识别期间记录已变化，请核对照片后重试');
 r.analysis={id:c.id('VA'),status:'待核对',processedAt:prepared.processedAt,provider:prepared.provider,...prepared.result};r.version++;r.updatedAt=c.now();
 const result={id:r.id,version:r.version,analysis:r.analysis};(s.requestRecords||=[]).push({key,userId:u.id,path:PATH,digest:digest(b),result:structuredClone(result),createdAt:c.now()});c.audit(s,u,'companion:photo-recognize',r.id);return result;
}
function confirm(s,u,b){const r=record(s,u,b.id);
 if(!Number.isInteger(b.version)||r.version!==b.version||r.archived)throw new c.HttpError(409,'照片记录已更新，请刷新后核对');
 if(!r.analysis||r.analysis.id!==b.analysisId||r.analysis.status!=='待核对')throw new c.HttpError(409,'这次识别结果已处理或不存在');
 const field=(v,name,max)=>{const text=c.text(v,name);if(text.length>max)throw new c.HttpError(400,name+'过长');return text;};
 const title=field(b.title,'照片名称',160),content=field(b.content,'核对后的内容',6000),tags=b.tags?field(b.tags,'关键词',160):'';
 (r.history||=[]).push({title:r.title,content:r.content,note:r.note,updatedAt:r.updatedAt});r.history=r.history.slice(-5);
 Object.assign(r,{title,content,tags,version:r.version+1,updatedAt:c.now(),source:'照片识别，经本人核对'});
 r.analysis={id:r.analysis.id,status:'已核对',processedAt:r.analysis.processedAt,confirmedAt:c.now(),provider:r.analysis.provider,...(r.analysis.medicineNotice?{medicineNotice:r.analysis.medicineNotice}:{})};
 c.audit(s,u,'companion:photo-confirm',r.id);return {id:r.id,version:r.version,confirmed:true};
}
function dismiss(s,u,b){const r=record(s,u,b.id);if(r.version!==b.version||!r.analysis||r.analysis.id!==b.analysisId||r.analysis.status!=='待核对')throw new c.HttpError(409,'这次识别结果已变化，请刷新');r.analysis={id:r.analysis.id,status:'不用保存',processedAt:r.analysis.processedAt};r.version++;r.updatedAt=c.now();return {dismissed:true};}
module.exports={MEDICINE_NOTICE,createClient,defaultClient,status,record,previous,prepare,commit,confirm,dismiss};
