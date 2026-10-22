'use strict';
const fs=require('fs'),path=require('path');
const importer=require('../server/src/employee-knowledge-import');
const {transaction}=require('../server/src/repository');
const file=path.resolve(process.argv[2]||path.join(__dirname,'../data/knowledge-imports/mobile-20261009/bundle.json'));
const bundle=JSON.parse(fs.readFileSync(file,'utf8'));
const result=transaction(store=>{const owner=store.users.find(u=>u.roleCode==='owner'&&u.status==='active');if(!owner)throw Error('没有在职老板账号，不能导入');const business=JSON.stringify(Object.fromEntries(Object.entries(store).filter(([key])=>!['employeeKnowledge','knowledgeImports','operationLogs'].includes(key))));const result=importer.apply(store,owner,bundle);if(JSON.stringify(Object.fromEntries(Object.entries(store).filter(([key])=>!['employeeKnowledge','knowledgeImports','operationLogs'].includes(key))))!==business)throw Error('业务账变更校验失败，回滚本次导入');return {...result,businessRecordsUnchanged:true};});
console.log(JSON.stringify(result));
