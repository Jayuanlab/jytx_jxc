'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const Module=require('node:module'),load=Module._load;Module._load=function(name,...args){return name==='xlsx'?{}:load.call(this,name,...args)};
const {chromium}=require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.NODE_ENV='test';process.env.STORE_DB_PATH=':memory:';process.env.STORE_AUTH_DB_PATH=':memory:';process.env.HIDE_FEISHU='1';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-upload-ui-'));process.env.STORE_SEED_PATH=path.join(temp,'seed.json');
const c=require('../server/src/common'),owner={id:'boss',name:'老板',roleCode:'owner',status:'active'},staff={id:'staff',name:'员工',roleCode:'employee',status:'active'},kiosk={id:'kiosk',name:'接待机器人',roleCode:'customer-assistant',status:'active'};
fs.writeFileSync(process.env.STORE_SEED_PATH,JSON.stringify(c.initialize({users:[owner,staff,kiosk],sales:[{id:'keep'}]})));
const repository=require('../server/src/repository'),sessions=require('../server/src/auth-sessions'),{createServer}=require('../server/src/application');
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});await ctx.addCookies([{name:'erp_session',value:sessions.issue(owner.id),url:origin}]);
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/m');await page.locator('a[href="/knowledge"]').click();
  await page.locator('#upload-section').waitFor({state:'visible'});assert.equal(await page.locator('#upload-title').isEnabled(),false);
  const text='# 收货培训\n\n收到多少就确认多少，不提前补齐未到货。\n\n抽屉现金交接须由实际接收人确认。',bytes=Buffer.from(text),before=JSON.stringify(repository.readStore()),sha=createHash('sha256').update(bytes).digest('hex');
  await page.locator('#upload-file').setInputFiles({name:'门店学习.md',mimeType:'text/markdown',buffer:bytes});await page.locator('#upload-preview-button').click();await page.locator('#upload-status').filter({hasText:'请核对'}).waitFor();
  assert.equal(JSON.stringify(repository.readStore()),before);assert.equal(repository.readKnowledgeFile(sha),null);assert.equal(await page.locator('#upload-title').inputValue(),'门店学习');
  await page.locator('#upload-title').fill('门店验收培训');await page.locator('#upload-category').fill('采购与验收');await page.locator('#upload-confirm').click();
  await page.locator('#upload-status').filter({hasText:'上传成功'}).waitFor();let state=repository.readStore(),row=state.employeeKnowledge.find(x=>x.uploadSha256===sha);
  assert.ok(row);assert.equal(row.title,'门店验收培训');assert.equal(row.category,'采购与验收');assert.equal(row.policyStatus,'needs_review');assert.deepEqual(repository.readKnowledgeFile(sha),bytes);assert.deepEqual(state.sales,[{id:'keep'}]);
  await page.locator('#upload-status a').click();await page.locator('article#'+row.id+' .provenance summary').click();
  const downloadEvent=page.waitForEvent('download');await page.locator('article#'+row.id+' .provenance a').click();const download=await downloadEvent;assert.equal(download.suggestedFilename(),'门店学习.md');
  const dir=path.resolve('artifacts/knowledge-upload');fs.mkdirSync(dir,{recursive:true});const target=path.join(dir,'original.md');await download.saveAs(target);assert.deepEqual(fs.readFileSync(target),bytes);
  await page.locator('article#'+row.id+' [data-edit]').click();await page.locator('#edit-form [name=body]').fill('老板修订后的验收流程');await page.locator('#edit-form button[type=submit]').click();await page.locator('#status').filter({hasText:'修改已留痕'}).waitFor();
  assert.equal(repository.readStore().employeeKnowledge.find(x=>x.id===row.id).sourceFiles[0].sha256,sha);assert.deepEqual(repository.readKnowledgeFile(sha),bytes);
  await page.locator('#go-upload').click();await page.locator('#upload-file').setInputFiles({name:'副本.md',mimeType:'text/markdown',buffer:bytes});await page.locator('#upload-preview-button').click();await page.locator('#upload-status').filter({hasText:'已经上传过'}).waitFor();assert.equal(repository.readStore().knowledgeUploads.length,1);
  await page.locator('#upload-file').setInputFiles({name:'不支持.pdf',mimeType:'application/pdf',buffer:Buffer.from('fake')});await page.locator('#upload-preview-button').click();await page.locator('#upload-status').filter({hasText:'读取失败'}).waitFor();assert.equal(repository.readStore().knowledgeUploads.length,1);assert.match(await page.locator('#upload-status').textContent(),/目前支持/);
  await page.locator('#upload-section').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,'mobile-upload.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const calls=async(userId,path,method='GET',payload)=>{
   const response=await fetch(origin+path,{method,headers:{Cookie:'erp_session='+sessions.issue(userId)},...(payload?{body:payload}:{})});return response;
  };
  let form=new FormData();form.append('file',new Blob([bytes]),'学习.md');
  assert.equal((await calls(staff.id,'/api/assistant/knowledge/upload-preview','POST',form)).status,403);
  assert.equal((await calls(kiosk.id,'/api/assistant/knowledge/file?sha256='+sha)).status,403);
  assert.equal((await fetch(origin+'/api/assistant/knowledge/file?sha256='+sha)).status,401);
  assert.equal((await calls(staff.id,'/api/assistant/knowledge/file?sha256='+sha)).status,200);
  assert.equal((await calls(owner.id,'/api/assistant/knowledge/file?sha256=../../secret')).status,404);
  form=new FormData();form.append('file',new Blob([Buffer.from('另一份资料')]),'新学习.txt');form.append('title','x'.repeat(66));
  assert.equal((await calls(owner.id,'/api/assistant/knowledge/upload','POST',form)).status,400);assert.equal(repository.readStore().knowledgeUploads.length,1);
  const fakeHash='a'.repeat(64);assert.throws(()=>repository.transaction(s=>{repository.saveKnowledgeFile(fakeHash,Buffer.from('rollback'));s.knowledgeUploads.push({sha256:fakeHash});throw Error('abort');}));assert.equal(repository.readKnowledgeFile(fakeHash),null);assert.equal(repository.readStore().knowledgeUploads.length,1);
  await ctx.clearCookies();await ctx.addCookies([{name:'erp_session',value:sessions.issue(staff.id),url:origin}]);await page.goto(origin+'/knowledge');await page.locator('#status').filter({hasText:'篇资料'}).waitFor();assert.equal(await page.locator('#upload-section').isVisible(),false);
  assert.deepEqual(repository.readStore().sales,[{id:'keep'}]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({homeEntry:true,mobilePreviewAndConfirm:true,previewReadOnly:true,editableAfterUpload:true,originalDownloadByteExact:true,duplicatePreservesEdits:true,failureReasonVisible:true,ownerOnlyUpload:true,customerCannotDownload:true,originalAndArticlesAtomic:true,noBusinessLedgerChanges:true,mobileOverflow:false,pageErrors:errors.length,screenshots:dir}));
 }finally{await browser?.close();await new Promise(r=>server.close(r));sessions.close();fs.unlinkSync(process.env.STORE_SEED_PATH);fs.rmdirSync(temp);}
})().catch(e=>{console.error(e);process.exitCode=1});

