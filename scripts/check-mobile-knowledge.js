'use strict';
const {readStore}=require('../server/src/repository');
const knowledge=require('../server/src/employee-knowledge'),importer=require('../server/src/employee-knowledge-import'),assistant=require('../server/src/personal-assistant');
const assert=require('node:assert/strict');
const store=readStore(),owner=store.users.find(u=>u.roleCode==='owner'&&u.status==='active');
const report=importer.report(store,owner);assert.equal(report.report.inputFiles,19);assert.equal(report.report.duplicates.length,6);assert.equal(report.report.exam.questionCount,22);
const imported=knowledge.catalog(store,owner).items.filter(r=>r.importBatch==='mobile-20261009');assert.equal(imported.length,67);assert.equal(imported.filter(r=>r.policyStatus==='current').length,37);
const evidence=[];
for(const [question,pattern] of [['升档30元可以9元办理全光吗',/30元及以上.*9元/],['补卡多少钱',/10 元\/次/],['校园青春卡59元档有多少流量',/20.*30/],['和包券会员费是多少',/待核实/],['今天移动酬金到账多少',null]]){const result=assistant.ask(store,owner,{question});if(pattern)assert.match(result.answer,pattern);if(question.includes('到账'))assert.ok(!result.metrics?.knowledge);evidence.push({question,answer:result.answer,source:result.sources?.[0]?.label||null});}
console.log(JSON.stringify({importFingerprint:report.fingerprint,activeImported:imported.length,current:37,needsReview:30,disabled:knowledge.catalog(store,owner).manageItems.filter(r=>r.importBatch==='mobile-20261009'&&r.enabled===false).length,checks:evidence}));
