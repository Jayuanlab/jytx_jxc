'use strict';
const crypto=require('node:crypto');
const c=require('./common');
const MAX_BYTES=5*1024*1024,MAX_SECONDS=15*60;
function decode(body){
 const value=body?.data;
 if(typeof value!=='string'||value.length>MAX_BYTES*4/3+200)throw new c.HttpError(413,'接待录音最多5MB，请缩短后重新录制');
 const match=/^data:audio\/(webm|ogg|mp4)(?:;codecs=[a-zA-Z0-9.,_-]+)?;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match||match[2].length%4)throw new c.HttpError(400,'录音格式不正确');
 const bytes=Buffer.from(match[2],'base64'),kind=match[1];
 const valid=kind==='webm'?bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])):kind==='ogg'?bytes.toString('ascii',0,4)==='OggS':bytes.toString('ascii',4,8)==='ftyp';
 if(!valid||!bytes.length||bytes.length>MAX_BYTES||bytes.toString('base64')!==match[2])throw new c.HttpError(400,'录音内容不完整或格式不支持');
 const seconds=Number(body.durationSeconds);
 if(!Number.isFinite(seconds)||seconds<1||seconds>MAX_SECONDS)throw new c.HttpError(400,'接待录音须在1秒至15分钟内');
 if(body.consentConfirmed!==true)throw new c.HttpError(400,'请先告知顾客正在录音并确认');
 return {hash:crypto.createHash('sha256').update(bytes).digest('hex'),bytes,mime:'audio/'+kind,durationSeconds:Math.ceil(seconds)};
}
function stage(store,user,body,file,key){
 require('./reception-availability').assertEnabled();
 c.permit(user,'sell');
 if(typeof key!=='string'||!key||key.length>160)throw new c.HttpError(400,'录音请求编号无效');
 const staged=store.receptionAudioStaging||=[];
 const previous=staged.find(row=>row.key===key&&row.userId===user.id);
 if(previous){if(previous.hash!==file.hash)throw new c.HttpError(409,'同一录音请求的内容已变化，请重新开始');return {token:previous.token,alreadySaved:true};}
 const row={token:c.id('RA'),key,userId:user.id,hash:file.hash,mime:file.mime,bytes:file.bytes.length,durationSeconds:file.durationSeconds,consentConfirmedAt:c.now(),createdAt:c.now()};
 staged.push(row);c.audit(store,user,'reception:audio-stage',row.token+' '+row.hash.slice(0,12));
 return {token:row.token,alreadySaved:false};
}
function claim(store,user,token,reception){
 if(!token)return null;
 const row=(store.receptionAudioStaging||[]).find(x=>x.token===token&&x.userId===user.id);
 if(!row||row.claimedReceptionId||Date.now()-Date.parse(row.createdAt)>24*60*60*1000)throw new c.HttpError(409,'录音暂存已失效，请重新录制后再提交');
 row.claimedReceptionId=reception.id;row.claimedAt=c.now();
 return {hash:row.hash,mime:row.mime,bytes:row.bytes,durationSeconds:row.durationSeconds,recordedBy:user.id,consentConfirmedAt:row.consentConfirmedAt,attachedAt:row.claimedAt};
}
function replay(store,user,id){
 if(user.roleCode!=='owner')throw new c.HttpError(403,'只有老板账号可以听接待录音');
 const row=(store.receptions||[]).find(x=>x.id===id);
 if(!row?.audioEvidence)throw new c.HttpError(404,'这张接待单没有可回放的录音');
 return row.audioEvidence;
}
module.exports={decode,stage,claim,replay};
