'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const stocks = require('../src/assistant-stocks');

const at = Date.parse('2026-10-19T09:00:00+08:00');
function quoteResponse() {
  const fields = Array(47).fill('');
  Object.assign(fields, { 1:'贵州茅台', 2:'600519', 3:'1500', 4:'1490', 30:'20261019085900', 31:'10', 32:'0.67', 33:'1510', 34:'1480' });
  return new Response(`v_sh600519="${fields.join('~')}";`);
}
test('股票回答只呈现已核验行情，不采纳模型预测', async () => {
  let modelCalls = 0;
  const model = { configured:()=>true, request:async()=>{modelCalls++;return JSON.stringify({checks:['确认明天必涨']});} };
  const fetchImpl = async (url) => String(url).includes('qt.gtimg.cn') ? quoteResponse() : new Response('unavailable',{status:503});
  const result = await stocks.query('分析贵州茅台股票',{fetchImpl,now:at,model});
  assert.equal(modelCalls, 0);
  assert.equal(result.modelConnected, false);
  assert.match(result.answer, /来源：腾讯证券公开行情；数据时间：2026-10-19 08:59:00/);
  assert.match(result.answer, /最新价 1500\.00元/);
  assert.doesNotMatch(result.answer, /明天必涨/);
  assert.match(result.answer, /不能据此断言买卖/);
});
test('行情无效时明确说无法报价，不猜测数字', async () => {
  const result = await stocks.query('分析贵州茅台股票',{fetchImpl:async()=>new Response('bad data'),now:at});
  assert.match(result.answer, /行情来源暂时未返回有效数据/);
  assert.doesNotMatch(result.answer, /最新价/);
  assert.equal(result.sources.length, 0);
});
