const saleInput = require('../../web/assistant-sale-input');
const c = require('./common');
const erp = require('./erp');
const inventoryDetails = require('./inventory-details');
const search = require('./search');
const workbench = require('./workbench');
const guardian = require('./guardian');
const vocabulary = require('./search-vocabulary');
const language = require('./assistant-phrases');
const assistantDomains = require('./assistant-domains');
const assistantContext = require('./assistant-context');
const assistantClock = require('./assistant-clock');
const assistantPeriod = require('./assistant-period');
const assistantCapabilities = require('./assistant-capabilities');
const assistantNavigation = require('./assistant-navigation');
const assistantSupervision = require('./assistant-supervision');
const employeeKnowledge = require('./employee-knowledge');
const assistantSocial = require('./assistant-social');
const assistantProducts = require('./assistant-product-query');
const assistantProductCreate = require('./assistant-product-create');
const assistantRecords = require('./assistant-record-query');
const serialStatus = require('./assistant-serial-status');
const assistantTariffs = require('./assistant-tariff-query');
const assistantDialogue = require('./assistant-dialogue');
const assistantCustomer = require('./assistant-customer');
const promotionPolicy = require('./policy-knowledge-query');
const { notice } = require('./feishu-notices');

const phoneTypes = new Set(['智能机', '智能手机', '功能机', '老人机', '二手机', '二手手机']);
const money = (value) => `¥${c.round(value).toFixed(2)}`;
const spokenDay = (date) => date === c.day() ? '今天' : date === c.day(Date.now() - 86400000) ? '昨天' : date;
const wantsDetail = (question = '') => /(详细|明细|具体|展开|怎么算|如何计算|核算过程|逐笔|每笔)/.test(question);
const source = (label, id, href) => ({ label, id: String(id), href });
const answer = (text, user, sources = [], extra = {}) => ({
  answer: text, asOf: c.now(), scope: c.capabilities(user).allSales ? '全店授权范围' : '本人及岗位授权范围',
  sources: sources.slice(0, 20), ...extra,
});
const visibleSales = (store, user) => store.sales.filter((row) => c.capabilities(user).allSales || (row.salespersonId || row.operatorId) === user.id);
const visibleReturns = (store, user) => store.saleReturns.filter((row) => c.capabilities(user).allSales || (row.salespersonId || row.operatorId) === user.id);
const dateOf = (question) => {
  const match = question.match(/20\d{2}[-年/.](0?[1-9]|1[0-2])[-月/.](0?[1-9]|[12]\d|3[01])日?(?!\d)/);
  if (match) {
    const date=`${match[0].slice(0,4)}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;
    if(c.day(date+'T00:00:00+08:00')!==date)throw new c.HttpError(400,'日期不正确，请核对年月日');
    return date;
  }
  if (/前天/.test(question)) return c.day(Date.now() - 2 * 86400000);
  if (/昨天|昨日/.test(question)) return c.day(Date.now() - 86400000);
  return c.day();
};
function attendanceActor(store, user) {
  const actor = c.userById(store, user.id);
  if (actor.assistantCustomerOnly || (actor.roleCode === 'customer-assistant' || actor.roleCode === 'personal-assistant')) throw new c.HttpError(403, '出勤打卡只供门店员工使用');
  return actor;
}
const attendanceLocationPolicy = Object.freeze({coordinateSystem: 'WGS84', defaultRadiusMeters: 200,
  minRadiusMeters: 20, maxRadiusMeters: 5000, maxAccuracyMeters: 100, maxAgeSeconds: 300, maxFutureSeconds: 60,
  note: '手机定位仅供老板核对，不证明到店；定位异常仍可提交，不自动扣薪。'});
function attendanceCoordinate(value, label, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new c.HttpError(400, label + '不正确');
  return value;
}
function attendanceLocationSettings(store) {
  const row = store.attendanceLocationSettings;
  const configured = !!row && typeof row.address === 'string' && !!row.address.trim() &&
    typeof row.latitude === 'number' && Number.isFinite(row.latitude) && row.latitude >= -90 && row.latitude <= 90 &&
    typeof row.longitude === 'number' && Number.isFinite(row.longitude) && row.longitude >= -180 && row.longitude <= 180 &&
    Number.isInteger(row.radiusMeters) && row.radiusMeters >= attendanceLocationPolicy.minRadiusMeters && row.radiusMeters <= attendanceLocationPolicy.maxRadiusMeters;
  return configured ? {configured: true, address: row.address, latitude: row.latitude, longitude: row.longitude,
    radiusMeters: row.radiusMeters, coordinateSystem: 'WGS84', updatedAt: row.updatedAt || null, updatedByName: row.updatedByName || ''} :
    {configured: false, address: '', latitude: null, longitude: null, radiusMeters: attendanceLocationPolicy.defaultRadiusMeters,
      coordinateSystem: 'WGS84', updatedAt: null, updatedByName: ''};
}
function saveAttendanceLocationSettings(store, user, payload, at) {
  user = attendanceActor(store, user);
  if (user.roleCode !== 'owner') throw new c.HttpError(403, '仅老板本人可设置门店打卡位置');
  const address = fieldworkText(payload.address, '门店准确地址', true, 300);
  const latitude = attendanceCoordinate(payload.latitude, '门店纬度', -90, 90), longitude = attendanceCoordinate(payload.longitude, '门店经度', -180, 180);
  const radiusMeters = attendanceCoordinate(payload.radiusMeters, '打卡范围', attendanceLocationPolicy.minRadiusMeters, attendanceLocationPolicy.maxRadiusMeters);
  if (!Number.isInteger(radiusMeters)) throw new c.HttpError(400, '打卡范围必须为整数米');
  if (payload.coordinateSystem != null && payload.coordinateSystem !== 'WGS84') throw new c.HttpError(400, '门店坐标必须使用 WGS84');
  const before = attendanceLocationSettings(store);
  if (!before.configured || before.address !== address || before.latitude !== latitude || before.longitude !== longitude || before.radiusMeters !== radiusMeters) {
    store.attendanceLocationSettings = {address, latitude, longitude, radiusMeters, coordinateSystem: 'WGS84', updatedAt: at, updatedBy: user.id, updatedByName: user.name};
    c.audit(store, user, 'attendance:location-settings', JSON.stringify({before, after: attendanceLocationSettings(store)}));
  }
  return {locationSettings: attendanceLocationSettings(store), canManageLocationSettings: true, locationPolicy: {...attendanceLocationPolicy}, asOf: at};
}
function attendanceLocationInput(payload) {
  const hasEvidence = Object.hasOwn(payload, 'locationEvidence'), hasFailure = Object.hasOwn(payload, 'locationFailure');
  if (hasEvidence && hasFailure) throw new c.HttpError(400, '定位记录与定位失败原因不能同时填写');
  if (hasFailure) {
    if (!['permission-denied', 'unavailable', 'timeout', 'unsupported', 'unknown'].includes(payload.locationFailure)) throw new c.HttpError(400, '定位失败原因不正确');
    return {evidence: null, failure: payload.locationFailure};
  }
  if (!hasEvidence) return {evidence: null, failure: 'missing'};
  const row = payload.locationEvidence;
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new c.HttpError(400, '定位记录不正确');
  const latitude = attendanceCoordinate(row.latitude, '定位纬度', -90, 90), longitude = attendanceCoordinate(row.longitude, '定位经度', -180, 180);
  const accuracy = attendanceCoordinate(row.accuracy, '定位精度', 0, 100000);
  // ISO time must have a timezone and a valid calendar date, not a silently normalised date.
  const match = typeof row.capturedAt === 'string' && row.capturedAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  const captured = match && Date.parse(row.capturedAt), calendar = match && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!match || !Number.isFinite(captured) || Number(match[1]) < 1000 || calendar.getUTCFullYear() !== Number(match[1]) || calendar.getUTCMonth() !== Number(match[2]) - 1 || calendar.getUTCDate() !== Number(match[3]) || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || (match[7] !== 'Z' && (Number(match[7].slice(1,3)) > 23 || Number(match[7].slice(4,6)) > 59))) throw new c.HttpError(400, '定位采集时间不正确');
  if (row.coordinateSystem != null && row.coordinateSystem !== 'WGS84') throw new c.HttpError(400, '定位坐标必须使用 WGS84');
  // Ignore client identity and verdicts. Only these four raw fields inform the server decision.
  return {evidence: {latitude, longitude, accuracy, capturedAt: row.capturedAt}, failure: null};
}
function attendanceDistance(evidence, settings) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(evidence.latitude - settings.latitude), dLon = radians(evidence.longitude - settings.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(settings.latitude)) * Math.cos(radians(evidence.latitude)) * Math.sin(dLon / 2) ** 2;
  const bounded = Math.max(0, Math.min(1, a));
  return 6371000 * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
}
function attendanceLocationRecord(store, input, context, at) {
  const settings = attendanceLocationSettings(store), evidence = input.evidence;
  const distance = evidence && settings.configured ? attendanceDistance(evidence, settings) : null;
  const row = {context, coordinateSystem: 'WGS84', status: '待老板核对', reason: '', message: '', evidence: evidence ? {...evidence} : null,
    failure: input.failure, distanceMeters: distance == null ? null : Math.round(distance * 100) / 100, recordedAt: at, settingsSnapshot: {...settings}};
  let reason, message;
  if (!evidence) { reason = 'no-location'; message = '未取得手机定位，打卡已记录，待老板核对。'; }
  else if (!settings.configured) { reason = 'settings-missing'; message = '门店准确位置尚未设置，定位已记录，待老板核对。'; }
  else if (Date.parse(evidence.capturedAt) - Date.parse(at) > attendanceLocationPolicy.maxFutureSeconds * 1000) { reason = 'future'; message = '手机定位时间超前，待老板核对。'; }
  else if (Date.parse(at) - Date.parse(evidence.capturedAt) > attendanceLocationPolicy.maxAgeSeconds * 1000) { reason = 'stale'; message = '手机定位记录已过期，待老板核对。'; }
  else if (evidence.accuracy > attendanceLocationPolicy.maxAccuracyMeters) { reason = 'low-accuracy'; message = '手机定位精度不足，待老板核对。'; }
  else if (context === 'fieldwork') { reason = 'fieldwork-recorded'; message = '外勤手机位置已记录，不要求在门店范围内，仍由老板核对。'; row.status = '外勤位置已记录'; }
  else if (distance + evidence.accuracy <= settings.radiusMeters) { reason = 'inside'; message = '范围内（手机定位，仅供核对），不证明实际到店。'; row.status = '范围内（手机定位，仅供核对）'; }
  else if (distance - evidence.accuracy > settings.radiusMeters) { reason = 'outside'; message = '手机定位显示超出门店范围，打卡已记录，待老板核对。'; }
  else { reason = 'boundary-uncertain'; message = '手机定位误差范围跨越门店边界，待老板核对。'; }
  row.reason = reason; row.message = message;
  return row;
}
function attendanceHistoricalLocation(at, context) {
  return {context, coordinateSystem: 'WGS84', status: '待老板核对', reason: 'historical-missing', message: '旧打卡没有定位记录，仅保留原打卡时间。',
    evidence: null, failure: 'missing', distanceMeters: null, recordedAt: at, settingsSnapshot: null};
}
function supplementAttendanceLocation(store, user, payload, at) {
  user = attendanceActor(store, user);
  const id = fieldworkText(payload.attendanceId, '本人签到记录编号', true, 100);
  const row = (store.attendance || []).find((item) => item.id === id);
  if (!row) throw new c.HttpError(404, '签到记录不存在');
  if (row.userId !== user.id) throw new c.HttpError(403, '只能补充本人位置，不能代其他员工定位');
  if (row.checkOutAt) throw new c.HttpError(409, '已经签退，不能补充当前工作位置');
  const activeRows = (store.attendance || []).filter((item) => item.userId === user.id && !item.checkOutAt);
  if (activeRows.length !== 1 || activeRows[0].id !== row.id) throw new c.HttpError(409, '本人进行中的签到记录不唯一，请先核对');
  const checkInAt = typeof row.checkInAt === 'string' ? Date.parse(row.checkInAt) : NaN;
  if (!Number.isFinite(checkInAt) || checkInAt > Date.parse(at) || row.date !== c.day(at) || c.day(row.checkInAt) !== row.date) throw new c.HttpError(409, '只能为本人今天正在工作的有效签到补充位置');
  const active = activeFieldwork(store, user.id);
  if (active.length > 1 || active[0] && active[0].attendanceId !== row.id) throw new c.HttpError(409, '本人外勤与签到记录异常，请先核对');
  if (row.locationSupplements != null && !Array.isArray(row.locationSupplements)) throw new c.HttpError(409, '补充定位记录格式异常，请先核对');
  const input = attendanceLocationInput(payload);
  if (!input.evidence) throw new c.HttpError(400, '补定位需要取得手机位置；原签到记录已保留，请允许定位后重试');
  const locationReport = attendanceLocationRecord(store, input, active[0] ? 'fieldwork' : 'store', at);
  locationReport.message += ' 补充的是本次手机位置，不证明早先签到时的位置。';
  const supplement = {id: c.id('LS'), at, userId: user.id, name: user.name, locationReport, source: 'manual-supplement'};
  (row.locationSupplements ||= []).push(supplement);
  c.audit(store, user, 'attendance:location-supplement', row.id + ' · ' + supplement.id + ' · 保留原签到时间和定位记录');
  return {...attendanceView(store, row, at), supplement};
}
function reviewAttendanceLocation(store, user, payload, at) {
  user = attendanceActor(store, user);
  if (user.roleCode !== 'owner') throw new c.HttpError(403, '仅老板本人可核对打卡位置');
  if (!['confirmed', 'needs-followup'].includes(payload.decision)) throw new c.HttpError(400, '请选择核对通过或继续核对');
  if (payload.event === 'spot-check') return reviewAttendanceSpotCheck(store, user, payload, at);
  const note = fieldworkText(payload.note, '位置核对说明', true, 1000);
  const hasAttendance = Object.hasOwn(payload, 'attendanceId'), hasFieldwork = Object.hasOwn(payload, 'fieldworkId');
  if (hasAttendance === hasFieldwork) throw new c.HttpError(400, '请只指定一条签到或外勤记录');
  const id = fieldworkText(hasAttendance ? payload.attendanceId : payload.fieldworkId, '打卡记录编号', true, 100);
  if (!(hasAttendance ? ['checkin', 'checkout', 'supplement'] : ['start', 'end', 'checkpoint']).includes(payload.event)) throw new c.HttpError(400, '打卡点位不正确');
  const row = (hasAttendance ? store.attendance || [] : store.attendanceFieldwork || []).find((item) => item.id === id);
  if (!row) throw new c.HttpError(404, '打卡记录不存在');
  const parent = hasAttendance ? row : (store.attendance || []).find((item) => item.id === row.attendanceId && item.userId === row.userId);
  if (!parent) throw new c.HttpError(409, '外勤关联的签到记录不存在，请先核对');
  let point = row;
  if (hasAttendance && payload.event === 'supplement') {
    const supplementId = fieldworkText(payload.supplementId, '补充定位记录编号', true, 100);
    point = (Array.isArray(row.locationSupplements) ? row.locationSupplements : []).find((item) => item.id === supplementId);
    if (!point) throw new c.HttpError(404, '这条补充定位记录不存在');
  }
  if (!hasAttendance && payload.event === 'checkpoint') {
    const checkpointId = fieldworkText(payload.checkpointId, '外勤定位卡编号', true, 100);
    point = (row.checkpoints || []).find((item) => item.id === checkpointId);
    if (!point) throw new c.HttpError(404, '这条外勤定位卡不存在');
  }
  const eventAt = ['checkpoint', 'supplement'].includes(payload.event) ? point.at : row[hasAttendance ? (payload.event === 'checkin' ? 'checkInAt' : 'checkOutAt') : (payload.event === 'start' ? 'startAt' : 'endAt')];
  if (!eventAt) throw new c.HttpError(409, '该打卡点位尚未提交，不能提前核对');
  const key = ['checkpoint', 'supplement'].includes(payload.event) ? 'locationReport' : hasAttendance ? (payload.event === 'checkin' ? 'checkInLocation' : 'checkOutLocation') : (payload.event === 'start' ? 'startLocation' : 'endLocation');
  const location = point[key] || attendanceHistoricalLocation(eventAt, hasAttendance ? 'store' : 'fieldwork');
  const previous = location.humanReview;
  // A repeated identical confirmation is idempotent; a changed decision/note appends history.
  if (!previous || previous.decision !== payload.decision || previous.note !== note || previous.reviewerId !== user.id) {
    const review = {decision: payload.decision, note, reviewedAt: at, reviewerId: user.id, reviewerName: user.name};
    point[key] = {...location, humanReview: review, humanReviews: [...(location.humanReviews || []), review]};
    c.audit(store, user, 'attendance:location-review', JSON.stringify({id, event: payload.event, ...(payload.event === 'checkpoint' ? {checkpointId: point.id} : {}), ...(payload.event === 'supplement' ? {supplementId: point.id} : {}), ...review}));
  }
  return {...attendanceView(store, parent, at), ...(!hasAttendance ? {lastFieldwork: fieldworkView(row, at)} : {})};
}
function attendanceSpotCheckSettings(store) {
  const row = store.attendanceSpotCheckSettings;
  const valid = !!row && typeof row.enabled === 'boolean' && Number.isInteger(row.dailyCount) && row.dailyCount >= 1 && row.dailyCount <= 10 &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime || '') && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.endTime || '') && row.startTime < row.endTime &&
    Number.isInteger(row.responseMinutes) && row.responseMinutes >= 1 && row.responseMinutes <= 60;
  return valid ? {...row, policyNote: '当日已生成的随机计划按当时设置保留，调整次数和时段从下一日计划使用；关闭后不再发新任务，已经发出的未完成任务仍可回应。'} :
    {enabled: false, dailyCount: 1, startTime: '09:00', endTime: '18:00', responseMinutes: 10, updatedAt: null, updatedByName: '',
      policyNote: '默认关闭。老板保存并启用后，已签到未签退员工才会收到自动抽查。'};
}
function saveAttendanceSpotCheckSettings(store, user, payload, at) {
  user = attendanceActor(store, user);
  if (user.roleCode !== 'owner') throw new c.HttpError(403, '仅老板本人可设置自动抽查');
  if (typeof payload.enabled !== 'boolean' || !Number.isInteger(payload.dailyCount) || payload.dailyCount < 1 || payload.dailyCount > 10 ||
    typeof payload.startTime !== 'string' || typeof payload.endTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.endTime) || payload.startTime >= payload.endTime ||
    !Number.isInteger(payload.responseMinutes) || payload.responseMinutes < 1 || payload.responseMinutes > 60) throw new c.HttpError(400, '请设置是否启用、每天1至10次、同日开始结束时间及1至60分钟回应时限');
  const next = {enabled: payload.enabled, dailyCount: payload.dailyCount, startTime: payload.startTime, endTime: payload.endTime, responseMinutes: payload.responseMinutes};
  const before = attendanceSpotCheckSettings(store);
  if (Object.keys(next).some((key) => next[key] !== before[key]) || !store.attendanceSpotCheckSettings) {
    store.attendanceSpotCheckSettings = {...next, updatedAt: at, updatedBy: user.id, updatedByName: user.name};
    c.audit(store, user, 'attendance:spot-check-settings', JSON.stringify({before, after: attendanceSpotCheckSettings(store)}));
  }
  return {spotCheckSettings: attendanceSpotCheckSettings(store), canManageLocationSettings: true, asOf: at};
}
function cancelAttendanceSpotChecks(store, attendance, at) {
  for (const row of store.attendanceLocationRequests || []) if (row.attendanceId === attendance.id && row.userId === attendance.userId && ['pending', 'expired'].includes(row.status) && !row.respondedAt) {
    row.status = 'cancelled'; row.cancelledAt = at; row.cancelReason = 'checkout';
  }
}
function tickAttendanceSpotChecks(store, {at = c.now(), rng = Math.random} = {}) {
  const settings = attendanceSpotCheckSettings(store);
  const result = {enabled: settings.enabled, changed: false, created: 0, expired: 0, cancelled: 0, planned: 0};
  if (!settings.enabled) return result; // Disabled means no arrays, random plans, model calls or background writes.
  const time = typeof at === 'string' && Date.parse(at);
  if (!Number.isFinite(time) || typeof rng !== 'function') throw new c.HttpError(400, '自动抽查时钟不正确');
  const date = c.day(at), actors = new Map((store.users || []).filter((user) => user.status === 'active' && user.roleCode !== 'owner' && !user.assistantCustomerOnly && user.roleCode !== 'customer-assistant' && user.roleCode !== 'personal-assistant').map((user) => [user.id, user]));
  const active = (store.attendance || []).filter((row) => !row.checkOutAt && actors.has(row.userId));
  const eligible = new Map();
  for (const row of active) {
    if (!eligible.has(row.userId)) eligible.set(row.userId, row);
    else eligible.set(row.userId, null); // Ambiguous overlapping shifts cannot receive an automatic request.
  }
  const plans = JSON.parse(JSON.stringify(store.attendanceSpotCheckPlans || [])), requests = JSON.parse(JSON.stringify(store.attendanceLocationRequests || []));
  for (const row of requests) if (['pending', 'expired'].includes(row.status) && !row.respondedAt) {
    const shift = eligible.get(row.userId);
    if (!shift || shift.id !== row.attendanceId) { row.status = 'cancelled'; row.cancelledAt = at; row.cancelReason = 'shift-inactive'; result.cancelled++; }
    else if (row.status === 'pending' && Date.parse(row.dueAt) < time) { row.status = 'expired'; row.expiredAt = at; result.expired++; }
  }
  for (const [userId, attendance] of eligible) {
    if (!attendance || !Number.isFinite(Date.parse(attendance.checkInAt)) || Date.parse(attendance.checkInAt) > time) continue;
    let plan = plans.find((row) => row.date === date && row.userId === userId && row.attendanceId === attendance.id);
    if (!plan) {
      const start = Date.parse(date + 'T' + settings.startTime + ':00+08:00'), end = Date.parse(date + 'T' + settings.endTime + ':00+08:00');
      if (time < start || time >= end) continue;
      const from = Math.max(start, time, Date.parse(attendance.checkInAt));
      const used = requests.filter((row) => row.date === date && row.userId === userId && row.source === 'automatic').length;
      const count = Math.max(0, settings.dailyCount - used), minuteCount = Math.floor((end - from) / 60000);
      const plannedCount = Math.min(count, minuteCount);
      const slots = [];
      for (let index = 0; index < plannedCount; index++) {
        const random = rng();
        if (typeof random !== 'number' || !Number.isFinite(random) || random < 0 || random >= 1) throw new c.HttpError(400, '自动抽查随机数不正确');
        const lo = Math.floor(index * minuteCount / plannedCount), hi = Math.floor((index + 1) * minuteCount / plannedCount);
        const slotAt = from + (lo + Math.floor(random * (hi - lo))) * 60000;
        slots.push({at: new Date(slotAt).toISOString(), status: 'planned', requestId: null});
      }
      plan = {id: c.id('SP'), date, userId, attendanceId: attendance.id, createdAt: at, settingsSnapshot: {...settings}, slots};
      plans.push(plan); result.planned++;
    }
    for (const slot of plan.slots || []) {
      if (slot.status !== 'planned' || Date.parse(slot.at) > time) continue;
      const due = Date.parse(slot.at) + plan.settingsSnapshot.responseMinutes * 60000;
      if (time > due) { slot.status = 'skipped'; slot.skippedAt = at; slot.skipReason = 'expired-slot'; continue; }
      if (requests.some((row) => row.userId === userId && row.status === 'pending' && !row.respondedAt)) { slot.status = 'skipped'; slot.skippedAt = at; slot.skipReason = 'pending-request'; continue; }
      const request = {id: c.id('LR'), userId, name: actors.get(userId).name, attendanceId: attendance.id, date, createdAt: at,
        scheduledAt: slot.at, dueAt: new Date(time + plan.settingsSnapshot.responseMinutes * 60000).toISOString(), status: 'pending', source: 'automatic', respondedAt: null, responseLocation: null, late: false,
        planId: plan.id, settingsSnapshot: {...plan.settingsSnapshot}};
      requests.push(request); slot.status = 'sent'; slot.requestId = request.id; result.created++;
    }
  }
  if (JSON.stringify(plans) !== JSON.stringify(store.attendanceSpotCheckPlans || []) || JSON.stringify(requests) !== JSON.stringify(store.attendanceLocationRequests || [])) {
    store.attendanceSpotCheckPlans = plans; store.attendanceLocationRequests = requests; result.changed = true;
  }
  return result;
}
function respondAttendanceSpotCheck(store, user, payload, at) {
  const requestId = fieldworkText(payload.requestId, '自动抽查编号', true, 100), input = attendanceLocationInput(payload);
  const request = (store.attendanceLocationRequests || []).find((row) => row.id === requestId);
  if (!request) throw new c.HttpError(404, '自动抽查任务不存在');
  if (request.userId !== user.id) throw new c.HttpError(403, '只能回应本人的自动抽查');
  if (request.respondedAt && request.status === 'responded') return {request: {...request}, asOf: at};
  const shift = (store.attendance || []).find((row) => row.id === request.attendanceId && row.userId === user.id && !row.checkOutAt);
  if (!shift || !['pending', 'expired'].includes(request.status)) throw new c.HttpError(409, '该班次已经结束或抽查已取消，不能继续回应');
  const active = (store.attendance || []).filter((row) => row.userId === user.id && !row.checkOutAt);
  if (active.length !== 1 || !Number.isFinite(Date.parse(request.dueAt))) throw new c.HttpError(409, '抽查关联班次或时限异常，请先核对');
  request.responseLocation = attendanceLocationRecord(store, input, activeFieldwork(store, user.id).some((work) => work.attendanceId === shift.id) ? 'fieldwork' : 'store', at);
  request.respondedAt = at; request.late = Date.parse(at) > Date.parse(request.dueAt); request.status = 'responded';
  request.reviewRequired = request.late || request.responseLocation.status === '待老板核对';
  request.reviewReason = request.late ? 'late' : request.responseLocation.reason;
  request.reviewStatus = request.reviewRequired ? '待老板核对' : '手机定位已记录，仅供核对';
  request.reviewMessage = request.late ? '超过回应时限，位置已记录，待老板核对。' : request.responseLocation.message;
  c.audit(store, user, 'attendance:spot-check-respond', request.id + (request.late ? ' · 逾期回应，待老板核对' : ' · 本人回应'));
  return {request: {...request}, locationSettings: attendanceLocationSettings(store), asOf: at};
}
function reviewAttendanceSpotCheck(store, user, payload, at) {
  const requestId = fieldworkText(payload.requestId, '自动抽查编号', true, 100);
  if (Object.hasOwn(payload, 'attendanceId') || Object.hasOwn(payload, 'fieldworkId') || Object.hasOwn(payload, 'checkpointId')) throw new c.HttpError(400, '请只指定一条自动抽查回应');
  const request = (store.attendanceLocationRequests || []).find((row) => row.id === requestId);
  if (!request) throw new c.HttpError(404, '自动抽查任务不存在');
  if (!request.respondedAt || !request.responseLocation) throw new c.HttpError(409, '员工尚未回应，不能提前核对位置');
  const note = fieldworkText(payload.note, '位置核对说明', true, 1000), location = request.responseLocation, previous = location.humanReview;
  if (!previous || previous.decision !== payload.decision || previous.note !== note || previous.reviewerId !== user.id) {
    const review = {decision: payload.decision, note, reviewedAt: at, reviewerId: user.id, reviewerName: user.name};
    request.responseLocation = {...location, humanReview: review, humanReviews: [...(location.humanReviews || []), review]};
    request.reviewRequired = payload.decision === 'needs-followup'; request.reviewStatus = request.reviewRequired ? '待老板核对' : '已人工核对';
    c.audit(store, user, 'attendance:location-review', JSON.stringify({requestId, event: 'spot-check', ...review}));
  }
  return {request: {...request}, asOf: at};
}
function attendanceSpotCheckRequestView(row, at) {
  const expired = row.status === 'pending' && !row.respondedAt && Number.isFinite(Date.parse(row.dueAt)) && Date.parse(row.dueAt) < Date.parse(at);
  return {...row, ...(expired ? {status: 'expired', storedStatus: row.status, displayExpired: true} : {})};
}
function attendanceRows(store, user, date = c.day()) {
  const own = user.roleCode !== 'owner' && user.roleCode !== 'manager';
  return (store.attendance || []).filter((row) => row.date === date && (!own || row.userId === user.id));
}
function activeFieldwork(store, userId) {
  return (store.attendanceFieldwork || []).filter((row) => row.userId === userId && !row.endAt);
}
function attendanceSeconds(start, end) {
  const from = Date.parse(start), to = Date.parse(end);
  return Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, Math.floor((to - from) / 1000)) : 0;
}
function fieldworkView(row, at) {
  const durationSeconds = attendanceSeconds(row.startAt, row.endAt || at);
  return {...row, startLocation: row.startLocation || attendanceHistoricalLocation(row.startAt, 'fieldwork'),
    endLocation: row.endAt ? row.endLocation || attendanceHistoricalLocation(row.endAt, 'fieldwork') : null,
    checkpoints: (row.checkpoints || []).map((point) => ({...point, locationReport: point.locationReport || attendanceHistoricalLocation(point.at, 'fieldwork')})),
    status: row.endAt ? '已结束' : '进行中', durationSeconds, durationMinutes: Math.floor(durationSeconds / 60)};
}
function attendanceView(store, row, at) {
  const shiftStart = Date.parse(row.checkInAt), shiftEnd = Date.parse(row.checkOutAt || at);
  const records = (store.attendanceFieldwork || []).filter((work) => work.userId === row.userId && work.attendanceId === row.id);
  const fieldwork = records.map((work) => fieldworkView(work, at));
  // Outside work is part of this shift. Merge intersecting segments; never add it to total work time.
  const intervals = records.map((work) => [Math.max(shiftStart, Date.parse(work.startAt)), Math.min(shiftEnd, Date.parse(work.endAt || at))])
    .filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && to > from).sort((a, b) => a[0] - b[0]);
  let fieldworkMs = 0, from = null, to = null;
  for (const [nextFrom, nextTo] of intervals) {
    if (to !== null && nextFrom <= to) to = Math.max(to, nextTo);
    else { if (to !== null) fieldworkMs += to - from; from = nextFrom; to = nextTo; }
  }
  if (to !== null) fieldworkMs += to - from;
  const workSeconds = attendanceSeconds(row.checkInAt, row.checkOutAt || at), fieldworkSeconds = Math.floor(fieldworkMs / 1000);
  return {...row, locationSupplements: Array.isArray(row.locationSupplements) ? row.locationSupplements : [],
    checkInLocation: row.checkInLocation || attendanceHistoricalLocation(row.checkInAt, 'store'),
    checkOutLocation: row.checkOutAt ? row.checkOutLocation || attendanceHistoricalLocation(row.checkOutAt, 'store') : null,
    fieldwork, activeFieldwork: fieldwork.find((work) => !work.endAt) || null,
    fieldworkSummary: fieldwork.map((work) => work.location + (work.endAt ? '（已结束）' : '（进行中）')).join('、'),
    workSeconds, workMinutes: Math.floor(workSeconds / 60), fieldworkSeconds, fieldworkMinutes: Math.floor(fieldworkSeconds / 60)};
}
function fieldworkText(value, label, required = false, max = 1000) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw new c.HttpError(400, '请填写' + label);
  const text = value.trim();
  if (required && !text) throw new c.HttpError(400, '请填写' + label);
  if (text.length > max) throw new c.HttpError(400, label + '不能超过' + max + '字');
  return text;
}
function endFieldwork(store, user, work, at, reason, locationRecord) {
  if (work.endAt) return;
  work.endAt = at; work.endReason = reason; work.endLocation = locationRecord;
  c.audit(store, user, 'attendance:fieldwork-end', work.id + ' · ' + work.location + ' · ' + (reason === 'checkout' ? '签退时自动结束' : '本人结束外勤'));
}
function attendanceFeedback(view, action, outcome, eventAt, at) {
  return {...view, feedback: {action, outcome, repeated: ['already-active','already-finished'].includes(outcome),
    eventAt: eventAt || null, checkedAt: at, recorded: ['recorded','resumed'].includes(outcome)}};
}
function attendance(store, user, payload = {}) {
  user = attendanceActor(store, user);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new c.HttpError(400, '出勤参数不正确');
  // Bind submitted location to the authenticated account even if the browser session changed mid-request.
  if (Object.hasOwn(payload, 'locationOwnerId') && payload.locationOwnerId !== user.id) throw new c.HttpError(403, '登录账号已变化，请重新登录本人账号后再打卡');
  const action = c.text(payload.action, '出勤动作');
  const at = c.now();
  if (action === 'location-settings') return saveAttendanceLocationSettings(store, user, payload, at);
  if (action === 'location-review') return reviewAttendanceLocation(store, user, payload, at);
  if (action === 'spot-check-settings') return saveAttendanceSpotCheckSettings(store, user, payload, at);
  if (action === 'spot-check-respond') return respondAttendanceSpotCheck(store, user, payload, at);
  if (action === 'location-supplement') return supplementAttendanceLocation(store, user, payload, at);
  if (!['checkin', 'checkout', 'fieldwork-start', 'fieldwork-end', 'fieldwork-checkpoint'].includes(action)) throw new c.HttpError(400, '请选择签到、签退、下村外勤开始或结束');
  const locationInput = attendanceLocationInput(payload);
  const locationRecord = (context) => attendanceLocationRecord(store, locationInput, context, at);
  const date = c.day(at), ownToday = (store.attendance || []).filter((item) => item.userId === user.id && item.date === date);
  const openToday = ownToday.filter(item => !item.checkOutAt);
  if (openToday.length > 1) throw new c.HttpError(409, '今天有多条尚未签退的班次，请先核对，不能重复签到');
  const current = openToday[0] || ownToday.slice().sort((a,b) => Date.parse(b.checkInAt) - Date.parse(a.checkInAt))[0];
  const active = activeFieldwork(store, user.id);
  if (active.length > 1) throw new c.HttpError(409, '存在多条进行中的外勤，请先核对记录');
  const activeAttendance = active[0] && (store.attendance || []).find((row) => row.id === active[0].attendanceId && row.userId === user.id);
  if (active[0] && (!activeAttendance || activeAttendance.checkOutAt)) throw new c.HttpError(409, '外勤关联的签到记录异常，请先核对');
  if (action !== 'fieldwork-end' && current && activeAttendance && current.id !== activeAttendance.id) throw new c.HttpError(409, '存在重叠班次与跨天外勤，请先结束原外勤并核对签到记录');
  if (action === 'fieldwork-checkpoint') {
    const id = fieldworkText(payload.fieldworkId, '外勤记录编号', true, 100);
    const work = (store.attendanceFieldwork || []).find((item) => item.id === id);
    if (!work) throw new c.HttpError(active.length ? 404 : 409, active.length ? '外勤记录不存在' : '没有进行中的本人外勤，请先开始外勤');
    if (work.userId !== user.id) throw new c.HttpError(403, '只能记录本人外勤位置，不能代其他员工打卡');
    if (work.endAt || !active[0] || active[0].id !== work.id) throw new c.HttpError(409, '该外勤已经结束或不在进行中，不能继续定位打卡');
    const location = fieldworkText(payload.location, '村名或外勤地点', true, 200), workContent = fieldworkText(payload.workContent, '外勤工作内容');
    // HTTP Idempotency-Key replays the original result. Each new key is a new location visit.
    const checkpoint = {id: c.id('CP'), at, userId: user.id, name: user.name, location, workContent, locationReport: locationRecord('fieldwork')};
    (work.checkpoints ||= []).push(checkpoint);
    c.audit(store, user, 'attendance:fieldwork-checkpoint', work.id + ' · ' + checkpoint.id + ' · ' + location);
    return attendanceFeedback({...attendanceView(store, activeAttendance, at), lastFieldwork: fieldworkView(work, at), checkpoint}, action, 'recorded', checkpoint.at, at);
  }
  if (action === 'fieldwork-end') {
    const id = payload.fieldworkId == null ? '' : fieldworkText(payload.fieldworkId, '外勤记录编号', true, 100);
    const work = id ? (store.attendanceFieldwork || []).find((row) => row.id === id) : active[0] || (store.attendanceFieldwork || []).find((row) => row.userId === user.id && row.endAt);
    if (!work) throw new c.HttpError(id ? 404 : 409, id ? '外勤记录不存在' : '没有可结束的本人外勤记录');
    if (work.userId !== user.id) throw new c.HttpError(403, '只能结束本人外勤，不能代其他员工打卡');
    const row = (store.attendance || []).find((item) => item.id === work.attendanceId && item.userId === user.id);
    if (!row) throw new c.HttpError(409, '外勤关联的签到记录不存在，请先核对');
    const repeated = !!work.endAt;
    endFieldwork(store, user, work, at, 'fieldwork-end', locationRecord('fieldwork'));
    return attendanceFeedback({...attendanceView(store, row, at), lastFieldwork: fieldworkView(work, at)}, action, repeated ? 'already-finished' : 'recorded', work.endAt, at);
  }
  if (action === 'fieldwork-start') {
    const location = fieldworkText(payload.location, '村名或外勤地点', true, 200), workContent = fieldworkText(payload.workContent, '外勤工作内容');
    if (active[0]) {
      if (active[0].location !== location || active[0].workContent !== workContent) throw new c.HttpError(409, '已有其他进行中的外勤，请先结束后再开始新的外勤');
      return attendanceFeedback({...attendanceView(store, activeAttendance, at), lastFieldwork: fieldworkView(active[0], at)}, action, 'already-active', active[0].startAt, at);
    }
    if (current?.checkOutAt) throw new c.HttpError(409, '今天已经签退，不能重新开始外勤；请先核对出勤记录');
    let row = current;
    const autoCheckIn = !row;
    if (!row) {
      row = {id: c.id('AT'), userId: user.id, name: user.name, date, checkInAt: at, checkOutAt: null, checkInLocation: locationRecord('fieldwork')};
      (store.attendance ||= []).unshift(row);
      c.audit(store, user, 'attendance:checkin', row.id + ' · 下村外勤自动签到');
    }
    const work = {id: c.id('FW'), attendanceId: row.id, userId: user.id, name: user.name, date: row.date,
      location, workContent, startAt: at, endAt: null, autoCheckIn, startLocation: locationRecord('fieldwork')};
    (store.attendanceFieldwork ||= []).unshift(work);
    c.audit(store, user, 'attendance:fieldwork-start', work.id + ' · ' + location + (workContent ? ' · ' + workContent : ''));
    return attendanceFeedback({...attendanceView(store, row, at), lastFieldwork: fieldworkView(work, at)}, action, 'recorded', work.startAt, at);
  }
  if (action === 'checkin') {
    // A still-active overnight fieldwork belongs to its original shift, not a duplicate new shift.
    if (activeAttendance) return attendanceFeedback(attendanceView(store, activeAttendance, at), action, 'already-active', activeAttendance.checkInAt, at);
    if (current && !current.checkOutAt) return attendanceFeedback(attendanceView(store, current, at), action, 'already-active', current.checkInAt, at);
    // Returning to work is a new shift; the prior check-in, check-out, GPS and review are immutable.
    const resumed = !!current?.checkOutAt;
    if (resumed && (!Number.isFinite(Date.parse(current.checkOutAt)) || Date.parse(current.checkOutAt) > Date.parse(at))) throw new c.HttpError(409, '原签退时间异常，请先核对后再重新签到');
    const row = {id: c.id('AT'), userId: user.id, name: user.name, date, checkInAt: at, checkOutAt: null, checkInLocation: locationRecord('store'),
      ...(resumed ? {resumesAfterAttendanceId: current.id} : {})};
    (store.attendance ||= []).unshift(row);
    c.audit(store, user, 'attendance:checkin', row.id + (resumed ? ' · 重新签到恢复工作；原班次保留' : ''));
    return attendanceFeedback(attendanceView(store, row, at), action, resumed ? 'resumed' : 'recorded', row.checkInAt, at);
  }
  const row = current || activeAttendance;
  if (!row) throw new c.HttpError(409, '今天还没有签到记录，请先签到');
  if (row.checkOutAt) return attendanceFeedback(attendanceView(store, row, at), action, 'already-finished', row.checkOutAt, at);
  row.checkOutAt = at; row.checkOutLocation = locationRecord(active.length ? 'fieldwork' : 'store');
  cancelAttendanceSpotChecks(store, row, at);
  for (const work of active) endFieldwork(store, user, work, at, 'checkout', locationRecord('fieldwork'));
  c.audit(store, user, 'attendance:checkout', row.id);
  return attendanceFeedback(attendanceView(store, row, at), action, 'recorded', row.checkOutAt, at);
}
function getAttendance(store, user, date = c.day()) {
  user = attendanceActor(store, user);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00+08:00')) || c.day(date + 'T00:00:00+08:00') !== date) throw new c.HttpError(400, '日期格式不正确');
  const at = c.now(), rows = attendanceRows(store, user, date).map((row) => attendanceView(store, row, at));
  const privileged = ['owner', 'manager'].includes(user.roleCode);
  const roster = privileged ? store.users.filter((row) => row.status === 'active' && row.roleCode !== 'owner' && !row.assistantCustomerOnly && row.roleCode !== 'personal-assistant') : [];
  const signed = new Set(rows.map((row) => row.userId));
  const active = (store.attendanceFieldwork || []).filter((row) => !row.endAt && (privileged || row.userId === user.id)).map((row) => fieldworkView(row, at));
  return {date, rows, activeFieldwork: active, privileged, expected: roster.length,
    locationSettings: attendanceLocationSettings(store), canManageLocationSettings: user.roleCode === 'owner', locationPolicy: {...attendanceLocationPolicy},
    spotCheckSettings: attendanceSpotCheckSettings(store),
    spotCheckRequests: (store.attendanceLocationRequests || []).filter((request) => (privileged || request.userId === user.id) && (request.date === date || ['pending', 'expired'].includes(request.status))).slice(-100).reverse().map((request) => attendanceSpotCheckRequestView(request, at)),
    notRecorded: roster.filter((row) => !signed.has(row.id)).map((row) => row.name), asOf: at};
}
function submitReport(store, user, payload) {
  const text = c.text(payload.text, '上报情况');
  if (text.length > 1000) throw new c.HttpError(400, '情况说明不能超过1000字');
  const row = { id: c.id('AR'), authorId: user.id, author: user.name, text, status: '待老板核实', createdAt: c.now(), reviewedAt: null, reviewNote: '' };
  store.assistantReports ||= [];
  store.assistantReports.unshift(row);
  c.audit(store, user, 'assistant:report', row.id);
  notice(store, `assistant-report:${row.id}`, '员工情况上报', { id: row.id, summary: `${user.name} 提交一条待核实的情况；请到数字助理查看。` });
  return row;
}
function reports(store, user) {
  return (store.assistantReports || []).filter((row) => user.roleCode === 'owner' || row.authorId === user.id).slice(0, 100);
}
function reviewReport(store, user, payload) {
  if (user.roleCode !== 'owner') throw new c.HttpError(403, '仅老板可核实情况报告');
  const row = (store.assistantReports || []).find((item) => item.id === payload.id);
  if (!row) throw new c.HttpError(404, '情况报告不存在');
  if (row.status !== '待老板核实') throw new c.HttpError(409, '这条情况已经处理');
  if (!['已核实', '无需处理'].includes(payload.status)) throw new c.HttpError(400, '处理结果不正确');
  row.status = payload.status;
  row.reviewNote = String(payload.note || '').trim().slice(0, 500);
  row.reviewedAt = c.now();
  c.audit(store, user, 'assistant:report-review', `${row.id} ${row.status}`);
  return row;
}
function phoneSales(store, user, date) {
  const sales = visibleSales(store, user).filter((row) => c.day(row.createdAt) === date);
  const returns = visibleReturns(store, user).filter((row) => c.day(row.createdAt) === date);
  const lines = (rows) => rows.flatMap((row) => (row.items || []).filter((item) => phoneTypes.has(item.type)).map((item) => ({ row, item })));
  const sold = lines(sales), refunded = lines(returns);
  const soldUnits = sold.reduce((sum, row) => sum + Number(row.item.quantity || 0), 0);
  const returnedUnits = refunded.reduce((sum, row) => sum + Number(row.item.quantity || 0), 0);
  return answer(`${date}手机销售 ${soldUnits} 台，退货 ${returnedUnits} 台，按单据日期计算净售 ${soldUnits - returnedUnits} 台。统计品类：智能机、功能机、二手机；退货按退货发生日扣减。`, user,
    [source('销售单查询',date,'/app?tab=orders'), ...[...sales, ...returns].filter((row) => (row.items || []).some((item) => phoneTypes.has(item.type))).map((row) => source('销售或退货单', row.id, '/app?tab=orders'))],
    { metrics: { soldUnits, returnedUnits, netUnits: soldUnits - returnedUnits, date } });
}
function salesVolume(store, user, date, question, staffId = null) {
  const brands = ['华为', '荣耀', 'OPPO', 'vivo', '苹果', 'iPhone', '小米', '红米', '三星', '一加', 'realme', '魅族', '中兴', '努比亚'];
  const brand = brands.find((value) => question.toLowerCase().includes(value.toLowerCase()));
  const phonesOnly = /手机|智能机|功能机|二手机|多少台|几台/.test(question);
  const products = new Map((store.products || []).map((product) => [product.skuId, product]));
  const matches = (item) => {
    const product = products.get(item.skuId) || {};
    if (phonesOnly && !phoneTypes.has(item.type || product.type)) return false;
    if (!brand) return true;
    const words = [item.name, product.name, product.shortName, product.subType, product.thirdType, ...(Array.isArray(product.aliases) ? product.aliases : [])];
    return words.some((word) => String(word || '').toLowerCase().includes(brand.toLowerCase()));
  };
  const sales = visibleSales(store, user).filter((row) => c.day(row.createdAt) === date && (!staffId || (row.salespersonId || row.operatorId) === staffId));
  const returns = visibleReturns(store, user).filter((row) => c.day(row.createdAt) === date && (!staffId || (row.salespersonId || row.operatorId) === staffId));
  const matchedSales = sales.filter((row) => (row.items || []).some(matches));
  const matchedReturns = returns.filter((row) => (row.items || []).some(matches));
  const units = (rows) => rows.reduce((sum, row) => sum + (row.items || []).filter(matches).reduce((lineSum, item) => lineSum + Number(item.quantity || 0), 0), 0);
  const soldUnits = units(matchedSales);
  const returnedUnits = units(matchedReturns);
  const label = (staffId ? (store.users.find((row) => row.id === staffId)?.name || '该员工') + '的' : '') + (brand ? brand + (phonesOnly ? '手机' : '商品') : phonesOnly ? '手机' : '商品');
  const unit = phonesOnly ? '台' : '件';
  let text = !soldUnits && !returnedUnits ? `${spokenDay(date)}${label}没有销量记录。` :
    returnedUnits ? `${spokenDay(date)}${label}卖出 ${soldUnits} ${unit}，退货 ${returnedUnits} ${unit}，净售 ${soldUnits - returnedUnits} ${unit}。` :
    `${spokenDay(date)}${label}卖出 ${soldUnits} ${unit}。`;
  if (wantsDetail(question) && (soldUnits || returnedUnits)) text += [matchedSales.length && `销售单 ${matchedSales.length} 笔`,matchedReturns.length && `退货单 ${matchedReturns.length} 笔`].filter(Boolean).join('，') + '。';
  return answer(text, user, [source('销售单查询', date, '/app?tab=orders'), ...[...matchedSales, ...matchedReturns].map((row) => source('销售或退货单', row.id, '/app?tab=orders'))],
    { metrics: { soldUnits, returnedUnits, netUnits: soldUnits - returnedUnits, orderCount: matchedSales.length, returnOrderCount: matchedReturns.length, date, brand: brand || null, phonesOnly, staffId } });
}
function salesSummary(store, user, date, question = '') {
  const report = erp.report(store, user, date);
  const s = report.summary;
  const rows = visibleSales(store, user).filter((row) => c.day(row.createdAt) === date);
  const returns = visibleReturns(store, user).filter((row) => c.day(row.createdAt) === date);
  let text = !s.orderCount && !s.returnAmount ? `${spokenDay(date)}没有销售记录。` : `${spokenDay(date)}销售 ${s.orderCount} 单，销售额 ${money(s.salesAmount)}。`;
  if (s.returnAmount) text += `退货 ${money(s.returnAmount)}，净销售额 ${money(s.netSales)}。`;
  if (wantsDetail(question) && (s.orderCount || s.returnAmount)) {
    const parts=[s.receivedAmount && `已登记收款 ${money(s.receivedAmount)}`,c.capabilities(user).profit && `销售毛利 ${money(s.adjustedGrossProfit)}`].filter(Boolean);
    if (parts.length) text += parts.join('，') + '。';
  }
  return answer(text, user, [source('销售日报',date,'/app?tab=dashboard'), ...[...rows, ...returns].map((row) => source('销售或退货单', row.id, '/app?tab=orders'))], { metrics: { ...s, date } });
}
function salesItemsAnswer(store, user, date, question) {
  const brand = ['华为','荣耀','OPPO','vivo','苹果','iPhone','小米','红米','三星','一加','realme','魅族','中兴','努比亚'].find((word) => question.toLowerCase().includes(word.toLowerCase()));
  const phoneOnly = /手机|智能机|功能机|二手机/.test(question);
  const products = new Map((store.products || []).map((p) => [p.skuId,p]));
  const matches = (item) => {
    const p = products.get(item.skuId) || {};
    if (phoneOnly && !phoneTypes.has(item.type || p.type)) return false;
    return !brand || [item.name,p.name,p.shortName,p.subType,p.thirdType,...(Array.isArray(p.aliases)?p.aliases:[])].some((word) => String(word || '').toLowerCase().includes(brand.toLowerCase()));
  };
  const rows = visibleSales(store,user).filter((row) => c.day(row.createdAt) === date);
  const lines = rows.flatMap((row) => (row.items || []).filter(matches).map((item) => ({row,item})));
  const grouped = new Map();
  for (const {item} of lines) {
    const key = item.skuId || item.name;
    const found = grouped.get(key) || { name:item.name || products.get(item.skuId)?.name || '未命名商品', quantity:0 };
    found.quantity += Number(item.quantity || 0);
    grouped.set(key,found);
  }
  const total = [...grouped.values()].reduce((sum,row) => sum+row.quantity,0);
  const label = brand ? brand + (phoneOnly?'手机':'商品') : phoneOnly?'手机':'商品';
  const detail = [...grouped.values()].slice(0,15).map((row) => row.name + ' ' + row.quantity + (phoneOnly?' 台':' 件')).join('；');
  let text = lines.length ? `${spokenDay(date)}${label}卖了：${detail}${grouped.size>15?'；更多见销售单':''}。` : `${spokenDay(date)}${label}没有销售记录。`;
  if (wantsDetail(question) && lines.length) text += `共 ${total} ${phoneOnly?'台':'件'}、${new Set(lines.map(({row})=>row.id)).size} 笔销售单。`;
  return answer(text,user,[source('销售单查询',date,'/app?tab=orders'),...lines.map(({row})=>source('销售单',row.id,'/app?tab=orders'))],
    {metrics:{soldUnits:total,orderCount:new Set(lines.map(({row})=>row.id)).size,date,brand:brand||null,phonesOnly:phoneOnly}});
}
function profitAnswer(store, user, date, question = '') {
  if (!c.capabilities(user).profit) return answer('当前岗位没有成本或毛利查看权限。',user);
  const s=erp.report(store,user,date).summary;
  let text = !s.orderCount && !s.returnAmount && !s.giftCost && !s.costAdjustmentProfit ? `${spokenDay(date)}没有销售记录，暂无销售毛利。` :
    `${spokenDay(date)}销售毛利 ${money(s.adjustedGrossProfit)}，还没扣工资、房租等费用。`;
  if (wantsDetail(question) && (s.orderCount || s.returnAmount || s.giftCost || s.costAdjustmentProfit)) text += [`销售额 ${money(s.salesAmount)}`,s.returnAmount && `退货 ${money(s.returnAmount)}`,s.giftCost && `赠品成本 ${money(s.giftCost)}`,s.costAdjustmentProfit && `成本调整 ${money(s.costAdjustmentProfit)}`].filter(Boolean).join('，') + '。';
  return answer(text,user,
    [source('销售日报',date,'/app?tab=dashboard')],{metrics:{adjustedGrossProfit:s.adjustedGrossProfit,giftCost:s.giftCost,date}});
}
function purchasesAnswer(store,user,date,question = '') {
  const caps=c.capabilities(user);
  if (!caps.purchase && !caps.supplierView) return answer('当前岗位没有进货查询权限。',user);
  const rows=(store.purchases || []).filter((row)=>c.day(row.createdAt)===date && (caps.supplierView || row.operatorId===user.id));
  const grouped=new Map();
  for (const order of rows) for (const item of order.items || []) {
    const key=item.skuId || item.name;
    const found=grouped.get(key) || {name:item.name || '未命名商品',quantity:0};
    found.quantity += Number(item.quantity || 0);
    grouped.set(key,found);
  }
  const total=[...grouped.values()].reduce((sum,row)=>sum+row.quantity,0);
  const detail=[...grouped.values()].slice(0,15).map((row)=>row.name+' '+row.quantity+' 件').join('；');
  const pending=(store.procurementPlans || []).filter((row)=>row.status!=='received' && (caps.supplierView || row.operatorId===user.id)).length;
  let text=rows.length ? `${spokenDay(date)}进货入库：${detail}${grouped.size>15?'；更多见进货明细':''}。` : `${spokenDay(date)}没有进货入库记录。`;
  if (wantsDetail(question) && (rows.length || pending)) text += [rows.length && `已入库 ${rows.length} 单、${total} 件`,pending && `订货待全部验收 ${pending} 单`].filter(Boolean).join('；') + '。';
  return answer(text,user,[source('进货明细',date,'/app?tab=purchase'),...rows.map((row)=>source('进货单',row.id,'/app?tab=purchase'))],
    {metrics:{orderCount:rows.length,receivedUnits:total,pendingPlans:pending,date}});
}
function attendanceAnswer(store, user, date) {
  const data = getAttendance(store, user, date);
  const time = (value) => new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'});
  const workText = (row) => row.fieldwork.map((work) => `${work.location}：${time(work.startAt)}至${work.endAt ? time(work.endAt) : '进行中'}${work.workContent ? '，' + work.workContent : ''}`).join('；');
  if (!data.privileged) {
    const row = data.rows[0];
    const outside = row?.fieldwork.length ? `下村外勤：${workText(row)}。工作时长 ${row.workMinutes} 分钟（已含外勤），其中外勤 ${row.fieldworkMinutes} 分钟。` : '';
    const active = !row && data.activeFieldwork.length ? `另有跨天外勤进行中：${data.activeFieldwork.map((work) => work.location + '，开始于' + time(work.startAt)).join('；')}，可点结束外勤。` : '';
    return answer((row ? `${date}你的签到时间：${time(row.checkInAt)}；${row.checkOutAt ? '签退时间：' + time(row.checkOutAt) : '尚未签退'}。${outside}这是系统签到记录，不代表工资考勤已核定。` : `${date}没有查到你的签到记录；不能据此认定你缺勤。`) + active, user, row ? [source('本人签到记录', row.id, '/assistant')] : []);
  }
  const names = data.notRecorded.length ? `未登记签到：${data.notRecorded.join('、')}。` : '在职员工均有签到记录。';
  const eligible = new Set(store.users.filter(u => u.status === 'active' && u.roleCode !== 'owner' && !u.assistantCustomerOnly && u.roleCode !== 'personal-assistant').map(u => u.id));
  const signedPeople = new Set(data.rows.filter(row => eligible.has(row.userId)).map(row => row.userId));
  const workingPeople = new Set(data.rows.filter(row => eligible.has(row.userId) && !row.checkOutAt).map(row => row.userId));
  const outside = data.rows.filter((row) => row.fieldwork.length).map((row) => `${row.name}：${workText(row)}；工作 ${row.workMinutes} 分钟（含外勤），其中外勤 ${row.fieldworkMinutes} 分钟`).join('。');
  return answer(`${date}在职员工 ${data.expected} 人，已签到 ${signedPeople.size} 人，已签退 ${[...signedPeople].filter(id => !workingPeople.has(id)).length} 人。${names}${outside ? '下村外勤：' + outside + '。' : ''}未登记不等于缺勤；需人工核对请假和实际在岗。`, user,
    [source('出勤记录',date,'/assistant'), ...data.rows.map((row) => source(`${row.name}签到`, row.id, '/assistant'))]);
}
function briefing(store, user, date, question = '') {
  if (user.roleCode !== 'owner') return answer('全店简报仅老板可查看。', user);
  const report = erp.report(store,user,date).summary;
  const purchase = purchasesAnswer(store,user,date).metrics;
  const work = workbench.summary(store,user);
  const findings = guardian.inspect(store);
  const awaiting = (store.assistantReports || []).filter((row)=>row.status==='待老板核实');
  const attendance = getAttendance(store,user,date);
  const parts = [];
  if (report.orderCount) parts.push(`销售 ${report.orderCount} 单、${money(report.salesAmount)}，毛利 ${money(report.adjustedGrossProfit)}`);
  if (report.returnAmount) parts.push(`退货 ${money(report.returnAmount)}`);
  if (purchase.receivedUnits) parts.push(`今日进货 ${purchase.receivedUnits} 件`);
  if (work.pendingCount) parts.push(`待处理 ${work.pendingCount} 项`);
  if (awaiting.length) parts.push(`员工报告待核实 ${awaiting.length} 条`);
  if (wantsDetail(question)) {
    if (report.receivedAmount) parts.push(`已登记收款 ${money(report.receivedAmount)}`);
    if (purchase.pendingPlans) parts.push(`订货待全部验收 ${purchase.pendingPlans} 单`);
    if (findings.length) parts.push(`系统待核实线索 ${findings.length} 条`);
    if (attendance.rows.length) parts.push(`已签到 ${attendance.rows.length} 人`);
  }
  const text = `${spokenDay(date)}店况：${parts.length ? parts.join('；') : '暂无已入账业务和待办'}。`;
  return answer(text,user,[source('销售日报',date,'/app?tab=dashboard'),source('进货明细',date,'/app?tab=purchase'),source('老板待办',date,'/m#pending')]);
}
function inventoryAnswer(store, user, question) {
  const caps = c.capabilities(user);
  if (!caps.sell && !caps.purchase && !caps.stocktake && !caps.manageProducts) return answer('当前岗位没有库存查询权限。', user);
  const serial = question.match(/(?<!\d)\d{14,18}(?!\d)/)?.[0];
  const tail = !serial ? question.match(/(?:后四位|尾号)\D*(\d{4})(?!\d)/)?.[1] : null;
  const rows = erp.inventory(store, user).filter((row) => row.stockManaged !== false);
  if (serial || tail) {
    const matches = rows.flatMap((row) => (row.serials || []).filter((item) => serial ? item.no === serial : String(item.no).endsWith(tail)).map((item) => ({ row, item })));
    return answer(matches.length ? `找到 ${matches.length} 条串码记录：${matches.slice(0, 8).map(({row,item}) => `${row.name}，${row.warehouseName}，状态${item.status}，串码${item.no}`).join('；')}。${tail ? '仅凭后四位可能重号，请核对完整串码。' : ''}` : '当前可见库存中未找到该串码；历史销售或采购请到综合查询继续追踪。', user,
      matches.slice(0, 8).map(({row,item}) => source('库存串码', item.no, `/search?q=${encodeURIComponent(item.no)}`)));
  }
  const brands = ['华为','荣耀','OPPO','vivo','苹果','iPhone','小米','红米','三星','一加','realme','魅族','中兴','努比亚'];
  const brand = brands.find((value) => question.toLowerCase().includes(value.toLowerCase()));
  if (brand && /手机|智能机|功能机|二手机|库存|在库|串号|串码|仓库|查|找|调|看|拿|列|展示|货|剩|余/.test(question)) {
    const phoneOnly = /手机|智能机|功能机|二手机/.test(question);
    const label = brand + (phoneOnly ? '手机' : '商品');
    const unit = phoneOnly ? '台' : '件';
    const matched = rows.filter((row) => (!phoneOnly || phoneTypes.has(row.type)) && [row.name,row.shortName,row.subType,row.thirdType,...(row.aliases||[])].join(' ').toLowerCase().includes(brand.toLowerCase()) && Number(row.quantity || 0) > 0);
    if (/(串号|串码|IMEI|imei)/.test(question)) {
      const units = matched.flatMap((row) => (row.serials || []).filter((item) => ['可售','未激活'].includes(item.status)).map((item) => ({row,item})));
      const shown = units.slice(0,20);
      const detail = shown.map(({row,item}) => row.name + '，' + row.warehouseName + '，' + item.no).join('；');
      const message = units.length ? brand + '在库可售串号共 ' + units.length + ' 个：' + detail + (units.length>shown.length ? '；还有 ' + (units.length-shown.length) + ' 个，请打开库存明细继续核对' : '') + '。串号以库存记录为准，交付前请核对手机实物。' : '当前账套未找到' + brand + '手机的可售在库串号；请核对品牌、入库状态或到库存明细查询。';
      return answer(message,user,[source('库存明细',brand,'/search?q=' + encodeURIComponent(brand) + '&scope=inventory'),...shown.slice(0,8).map(({item})=>source('库存串号',item.no,'/search?q=' + encodeURIComponent(item.no)))]);
    }
    const grouped = new Map();
    for (const row of matched) { const key = row.skuId + '|' + row.warehouseId; const item = grouped.get(key) || {name:row.name,warehouseName:row.warehouseName,quantity:0,skuId:row.skuId}; item.quantity += Number(row.quantity || 0); grouped.set(key,item); }
    const values = [...grouped.values()];
    const total = values.reduce((sum,row) => sum + row.quantity,0);
    return answer(values.length ? label + '当前账面库存 ' + total + ' ' + unit + '，' + values.length + ' 个商品与仓库组合：' + values.slice(0,20).map((row) => row.name + '，' + row.warehouseName + ' ' + row.quantity + ' ' + unit).join('；') + (values.length > 20 ? '；更多请打开库存明细' : '') + '。数量以盘点为准。' : '当前账套没有查到在库的' + label + '；可检查品牌名称或库存是否已入账。', user,
      values.slice(0,20).map((row) => source('商品库存',row.name,'/search?q=' + encodeURIComponent(row.name))));
  }
  const terms = store.products.filter((p) => p.active !== false).flatMap((p) => [p.name, p.shortName, p.externalCode, ...(p.aliases || [])].filter(Boolean).map((term) => ({ p, term: String(term) })));
  const found = terms.filter(({term}) => term.length >= 2 && question.toLowerCase().includes(term.toLowerCase())).sort((a,b) => b.term.length - a.term.length)[0];
  if (found) {
    const hits = rows.filter((row) => row.skuId === found.p.skuId);
    return answer(hits.length ? `${found.p.name} 当前账面库存 ${hits.reduce((sum,row) => sum + Number(row.quantity || 0), 0)} 件：${hits.map((row) => `${row.warehouseName} ${row.quantity} 件`).join('；')}。这是账面数量，实际在库以盘点为准。` : `${found.p.name} 当前没有可见的账面库存记录。`, user,
      [source('商品库存', found.p.externalCode || found.p.skuId, `/search?q=${encodeURIComponent(found.p.name)}`)]);
  }
  const total = rows.reduce((sum,row) => sum + Number(row.quantity || 0), 0);
  return answer(`当前账面库存共 ${total} 件，涉及 ${new Set(rows.map((row) => row.skuId)).size} 种实物商品。可继续问商品名称、编号或串码；数量以盘点结果为准。`, user, [source('库存明细', '库存', '/app?tab=inventory')]);
}
function productMentioned(store, product, question) {
  const words = vocabulary.productFields(product).flat(Infinity).filter((word) => String(word || '').length >= 2).map(String);
  const normalized = question.toLocaleLowerCase('zh-CN');
  if (words.some((word) => normalized.includes(word.toLocaleLowerCase('zh-CN')))) return true;
  return (store.searchSynonyms || []).some((group) => (group.terms || []).some((word) => words.some((field) => field.toLocaleLowerCase('zh-CN').includes(String(word).toLocaleLowerCase('zh-CN')))) && (group.terms || []).some((word) => String(word).length >= 2 && normalized.includes(String(word).toLocaleLowerCase('zh-CN'))));
}
function receptionDraft(user, question) {
  const phone = question.match(/(?<!\d)1[3-9]\d{9}(?!\d)/)?.[0] || '';
  const name = question.match(/(?:顾客|客户)(?:姓名|名字)?叫([\u4e00-\u9fa5]{2,8})/)?.[1] || '';
  const purpose = ['购买手机','咨询手机','号卡','充值','宽带','套餐','维修','配件','售后'].find((item) => question.includes(item)) || (/(?:买|购买|要|选).{0,8}手机/.test(question) ? '购买手机' : /(?:问|咨询|看).{0,8}手机/.test(question) ? '咨询手机' : '其他咨询');
  const prefill = { phone, name, source:'到店', purpose, needs: question.slice(0,500) };
  return answer('已准备接待单草稿'+(phone?'，手机号 '+phone:'')+'，来意 '+purpose+'。请核对顾客信息和需求后提交；目前没有创建正式接待单。',user,[source('接待单','新建','/receptions')],{action:{type:'navigate',label:'核对接待单草稿',href:'/receptions',prefill}});
}
function isPhoneReservation(question) {
  return /(预订|订了|(?<![确选])定了|(?:顾客|客户|用户|买家)(?:已经|刚刚)?定(?:这台|一台|手机|\s|$))/.test(question);
}
function businessIntent(store, question) {
  const lookup = /(查|找|调|看|给我看|拿出来|列出|展示)/.test(question);
  const stock = /(库存|在库|存货|现货|仓库|还有货|剩余|串号|串码|有多少货|还有多少货|(?:还有|剩|余).{0,5}(?:台|件|个))/.test(question);
  const report = /(今天|昨天|昨日|多少|几台|统计|销量|销售额|营业额|订单|流水|价格|售价|多少钱)/.test(question);
  const saleForm = /(?:开|建|做|填|出).{0,6}(?:销售)?单|录单|下单|生成销售草稿|帮我卖|卖一台|卖一件/.test(question);
  const shortSelection = /^(?:顾客|客户|用户|买家)(?:已经|刚刚)?(?:定|订了|选好了|确定了)[。！!？?]?$/.test(question);
  const saleStage = /(售出|卖出|成交|卖了|卖掉|销售了|买了|购买了|要了|想要|需要|选好了|选定了|选中了|挑好了|确定了|确认了|(?:顾客|客户|用户|买家).{0,4}要)/.test(question) || isPhoneReservation(question);
  const subject = /手机|智能机|功能机|二手机|华为|荣耀|OPPO|vivo|苹果|iPhone|小米|红米|三星|一加|realme|魅族|中兴|努比亚/i.test(question) || store.products.some((p) => p.active !== false && productMentioned(store,p,question));
  if (/(订货单|采购单|接待单)/.test(question)) return 'other';
  if (stock && lookup) return 'inventory';
  const parsed=saleInput.analyze(question);
  if(parsed.saleRequest&&(parsed.serialToken||/手机(?:串号|串码)/.test(question)))return 'sale';
  if (saleForm || shortSelection || saleInput.singlePhoneSale(question) || (parsed.saleRequest && /(?:记|登记|录入).{0,6}(?:销售|成交)|(?:销售|成交).{0,6}(?:记一下|登记|录入)|^(?:销售单|开单)[。！!\s]*$/.test(question))) return 'sale';
  if (subject && !/(?:今天|昨天|昨日).{0,15}(?:多少|几台|统计|销量|卖了什么)|统计|销量|销售额|营业额|汇报|赚了|毛利|利润|退货|取消/.test(question) && /(?:串号|串码|后四位|尾号)/.test(question) && /(?:售价|成交价|卖价|卖(?:了)?\s*[0-9一二两三四五六七八九十百千万])/.test(question)) return 'sale';
  if (stock) return 'inventory';
  if (report || /(不要了|不想要|不需要|退货|取消)/.test(question)) return 'other';
  if (saleStage && subject) return 'sale';
  if (lookup && subject) return 'inventory';
  return 'other';
}
function saleDraft(store, user, question) {
  if (!c.capabilities(user).sell) return answer('当前岗位没有销售开单权限。', user);
  if (/^(?:顾客|客户|用户|买家)(?:已经|刚刚)?(?:定|订了|选好了|确定了)[。！!？?]?$/.test(question)) return answer('顾客选定或预订了什么商品？请说商品名称或型号，例如“华为手机”。我会再确认是预订还是已成交。',user,[],{saleFlow:{type:'product',request:question}});
  const parsedSale=saleInput.analyze(question);
  const namedPhones=store.products.filter(p=>p.active!==false&&inventoryDetails.phone(p)&&productMentioned(store,p,question));
  if (/手机/.test(question) || saleInput.singlePhoneSale(question) || /记.{0,6}销售|登记.{0,6}销售/.test(question) || namedPhones.length || (parsedSale.saleRequest&&parsedSale.serialToken)) {
    const reservation=isPhoneReservation(question);
    return answer(reservation ? '这可能只是预订。先确认顾客是否已经成交并准备交付；如果只是预订，应记接待跟进单，不能当作已销售扣库存。' : '我来按顺序帮你准备销售单。先说这台手机串号的后四位；如果有重号，我会让你选准确的那台。', user,
      [source('所属仓库存', '可售串码', '/app?tab=inventory')], {saleFlow:{type:'phone',request:question,reservation,candidateSkuIds:namedPhones.length?namedPhones.map(p=>p.skuId):undefined}});
  }
  const candidates = store.products.filter((p) => p.active !== false && productMentioned(store, p, question)).sort((a,b) => b.name.length - a.name.length);
  if (!candidates.length) return answer('可以打开空白销售单。请在单据中选择商品、顾客和收款账户，核对后再提交；目前没有从这句话识别出具体商品。', user, [source('销售开单','新建','/app?tab=sales')], { action: { type:'navigate', label:'打开销售单', href:'/app?tab=sales' } });
  if (candidates.length > 1) return answer(`匹配到多个商品：${candidates.slice(0,5).map((p) => p.name).join('、')}。请在销售单里选择准确商品并核对串码。`, user, [source('销售开单','选商品','/app?tab=sales')], {action:{type:'navigate',label:'到销售单选商品',href:'/app?tab=sales'}});
  const p = candidates[0];
  const stock = store.inventory.filter((row) => row.skuId === p.skuId && (row.warehouseId || 'wh-sale') === (p.warehouseId || 'wh-sale'));
  const available = p.stockManaged === false ? null : stock.reduce((sum,row) => sum + Number(row.quantity || 0), 0);
  if (available !== null && (available <= 0 || (inventoryDetails.tracked(p) && !stock.flatMap((row) => row.serials || []).some((row) => ['可售', '未激活'].includes(row.status))))) return answer(`${p.name} 所属仓当前没有可售库存或可售串码，暂不能加入销售单。`, user, [source('商品库存', p.externalCode || p.skuId, `/search?q=${encodeURIComponent(p.name)}`)]);
  const quantity = Math.min(99, Number(question.match(/(\d{1,2})\s*(?:台|件|个|张)/)?.[1] || 1));
  const account = ['微信','支付宝','现金','银行卡','云闪付'].find((name) => question.includes(name)) || '';
  const draft = { skuId:p.skuId, productName:p.name, quantity:inventoryDetails.tracked(p) ? 1 : quantity, account, referencePrice:Number(p.salePrice || 0), trackSerial:!!inventoryDetails.tracked(p) };
  return answer(`已找到 ${p.name}，档案零售价 ${money(draft.referencePrice)}${available === null ? '' : `，所属仓账面库存 ${available} 件`}。我可以把它带到销售单供你核对；${inventoryDetails.tracked(p) ? '串码商品须逐台选串码；' : ''}售价、顾客和收款仍由开单人确认，点击正式提交前不会入账。`, user,
    [source('商品档案', p.externalCode || p.skuId, `/search?q=${encodeURIComponent(p.name)}`)], { draft });
}
function generalSearch(store, user, question) {
  const identifier = question.match(/(?:SO|PO|RC|MV|MB|GB|GFT|MRC)-[a-z0-9-]+/i)?.[0] || question.match(/(?<!\d)\d{14,18}(?!\d)/)?.[0] || question.match(/(?:后四位|尾号)\D*(\d{4})(?!\d)/)?.[1];
  let term = identifier || question.replace(/^(?:请|帮我|给我|我想|我要|查一下|查找|查|查询|搜索|找|有没有|看一下|看)*\s*/g, '').replace(/^(?:订单号|销售单号|流水号|串号|串码|供货商|供应商|商品)(?:是|为|：|:|\s)*/,'').replace(/[？?。！!]+$/g,'').trim();
  if (term.length < 2 || term.length > 80) return answer('请给我商品名称、串码、订单号或供货商名称；没有可核实的关键词时，我不会猜测结果。', user, [], {unresolved:true});
  try {
    const result = search.search(store, user, new URLSearchParams({q:term}));
    const rows = Object.entries(result.results).flatMap(([kind,values]) => values.slice(0,4).map((row) => ({kind,row})));
    if (!rows.length) return answer(identifier ? `没有找到这条编号的可见记录，请核对编号或点综合查询。` : '这句话还没识别清楚。你是想查库存、查单据、办业务，还是学习操作？可以说具体商品、单号或任务。', user, [source('功能与学习入口','帮助','/assistant')], {unresolved:true});
    const kinds = {inventory:'库存',sales:'销售单',purchases:'采购单',suppliers:'供货商',movements:'库存流水',receipts:'收支流水'};
    return answer(`找到 ${rows.length} 条可见记录（每类最多展示4条）：${rows.slice(0,10).map(({kind,row}) => `${kinds[kind]||kind} ${row.name || row.product || row.id || row.sourceId}`).join('；')}。请点来源进入综合查询核对完整内容。`, user,
      rows.slice(0,10).map(({kind,row}) => source(kinds[kind]||kind, row.id || row.skuId || row.name, `/search?q=${encodeURIComponent(term)}`)));
  } catch (error) {
    if (error.statusCode === 403) return answer('当前岗位没有这项数据的查看权限。', user);
    throw error;
  }
}
function featureGuide(store,user) {
  const items=assistantCapabilities.catalog(store,user).items;
  return answer('我能查库存和单据、统计销售、解释待办、准备开单草稿，也能查工作积分和业务学习资料。下面是当前岗位的入口；入账和审批由人确认。',user,items.map(item=>source(item.label,item.mode==='query'?'查询':item.mode==='draft'?'准备草稿':'入口',item.href)));
}
function settingsGuide(user, kind) {
  if (kind === 'assistant') return user.roleCode === 'owner' ? answer('助理操作说法在数字助理页面下方“教助理理解说法”。可以新增、编辑和删除“平时怎么说 → 代表什么操作”；保存后全店生效。',user,[source('助理操作说法','设置','/assistant#phrase-panel')],{action:{type:'navigate',label:'打开助理说法设置',href:'/assistant#phrase-panel'}}) : answer('助理操作说法由老板维护；你可以把听不懂的说法发给老板。',user);
  return c.capabilities(user).manageProducts ? answer('商品同义词在“综合查询”页面下方的“维护商品叫法与同义词”；商品专属别名在“商品管理”编辑。可以点下面按钮直接进入同义词设置。',user,[source('商品同义词设置','入口','/search#vocabulary-panel'),source('商品档案别名','入口','/app?tab=products')],{action:{type:'navigate',label:'打开商品同义词设置',href:'/search#vocabulary-panel'}}) : answer('当前账号没有维护商品同义词的权限。请让老板或商品管理员在综合查询页面设置。',user);
}
function normalizeSpokenQuestion(value) {
  const spoken = value.trim()
    .replace(/^(?:(?:嗯|啊|那个|哎|喂)[，,、\s]*){1,3}/g, '')
    .replace(/机子/g, '手机')
    .replace(/(?:还有没得|还有没有|有没得|有货没得|有货没有|有现货没得)/g, '还有货吗')
    .replace(/(?:看中了|相中了|看上了|看中|相中|看上)/g, '选好了');
  return spoken || value.trim();
}
function askOnce(store, user, payload) {
  const spokenQuestion = c.text(payload.question, '问题');
  if (spokenQuestion.length > 1500) throw new c.HttpError(400, '问题不能超过1500字');
  const question = normalizeSpokenQuestion(spokenQuestion);
  const date = dateOf(question);
  const productCreate = assistantProductCreate.query(store,user,question);
  if (productCreate) return answer(productCreate.answer,user,productCreate.sources,productCreate);
  // Explicit payment-page navigation must not ask for a phone serial. A stated phone keeps serial reconciliation priority.
  const paymentEntry = assistantNavigation.findEntry(store,user,question);
  if (paymentEntry?.metrics?.featureId === 'payment' && !/(?:串号|串码|IMEI|后四位|后4位|尾号|这(?:一)?台|那(?:一)?台|这部|那部|它)|(?<!\d)\d{4,18}(?!\d)/i.test(question)) return answer(paymentEntry.answer,user,paymentEntry.sources,paymentEntry);
  if (/(?:顾客|客户|办卡).{0,4}(?:问答|话术).{0,8}(?:设置|维护|编辑|修改)|问答维护/.test(question)) return user.roleCode === 'owner' ? answer('在助理下方“顾客问答维护”选择问答，修改顾客说法和回答后保存。',user,[],{action:{type:'navigate',label:'打开顾客问答维护',href:'/assistant#dialogue-panel'}}) : answer('顾客问答由老板在助理下方维护。',user);
  const serialResult=serialStatus.query(store,user,question,payload.context);
  if(serialResult)return answer(serialResult.answer,user,serialResult.sources,serialResult);
  if(saleInput.receptionRequest(question))return receptionDraft(user,question);
  const dialogue = assistantDialogue.find(store,spokenQuestion);
  if (dialogue && !dialogue.slot) { const reply=assistantDialogue.manual(dialogue,payload.customerReplyStyle); return answer(reply.answer,user,reply.sources,reply); }
  if (dialogue?.slot?.startsWith('tariff:')) { const result=assistantTariffs.query(store,user,'我想办张手机卡',{customerReplyStyle:payload.customerReplyStyle,profile:payload.tariffProfile,awaiting:payload.tariffAwaiting}); if(result)return answer(result.answer,user,result.sources,result); }
  const social = assistantSocial.query(store,user,dialogue?.slot==='social:greeting'?'你好':spokenQuestion,{customerReplyStyle:payload.customerReplyStyle});
  if (social) return answer(social.answer,user,social.sources,social);
  if (/(助理说法|操作说法|教助理|助理听不懂|指令设置)/.test(question)) return settingsGuide(user,'assistant');
  if (/(同义词|商品别名|商品叫法|商品词库)/.test(question)) return settingsGuide(user,'product');
  const records = assistantRecords.query(store,user,question);
  if (records) return answer(records.answer,user,records.sources,records);
  const entry = assistantNavigation.findEntry(store,user,question);
  if (entry) return answer(entry.answer,user,entry.sources,entry);
  const periodResult = assistantPeriod.query(store,user,question);
  if (periodResult) return answer(periodResult.answer,user,periodResult.sources,periodResult);
  if (/(?:今天|今日|昨天|昨日|当日|本日).{0,8}(?:进了什么货|进了哪些货|进货明细|收了什么货|到货明细|入库了什么)|(?:进了什么货|进了哪些货|今天进货|今日进货)/.test(question)) return purchasesAnswer(store,user,date,question);
  if (/(本月|这个月|上个月|上月|本周|这周|上周|最近|近[一二三四五六七八九十\d]+天|这几天|今年|全年)/.test(question) && /(销量|销售|营业额|毛利|利润|出勤|工作|监督|积分|店况|进货)/.test(question) && !/(知识|技巧|怎么|如何|学习资料)/.test(question)) return answer('这项统计目前支持按天查询。请说具体日期；我不会把本周或本月当作今天回答。',user,[],{unsupportedRange:true});
  const taught = language.resolve(store, question);
  if (taught) {
    switch (taught.target) {
      case 'sale': return saleDraft(store,user,question);
      case 'reception': return receptionDraft(user,question);
      case 'purchase': return c.capabilities(user).purchase ? answer('可以打开订货单，供应商、商品及金额由你核对后提交。',user,[source('订货单','新建','/app?tab=purchase')],{action:{type:'navigate',label:'打开订货单',href:'/app?tab=purchase'}}) : answer('当前岗位没有订货权限。',user);
      case 'inventory': return inventoryAnswer(store,user,question);
      case 'salesSummary': return salesSummary(store,user,date,question);
      case 'attendance': return attendanceAnswer(store,user,date);
    }
  }
  if (/^(?:帮我|给我|我要|我想|请)?(?:下村打卡|外勤打卡|开始下村|开始外勤)(?:一下|吧)?[。！!？?]?$/.test(question)) return answer('请填写村名或外勤地点，确认后开始本人外勤；没有签到时会同时签到，外勤包含在工作时间内。',user,[],{action:{type:'attendance',operation:'fieldwork-start',label:'下村外勤打卡'}});
  if (/^(?:帮我|给我|我要|我想|请)?(?:结束外勤|结束下村|外勤结束|下村结束)(?:一下|吧)?[。！!？?]?$/.test(question)) { const active=(store.attendanceFieldwork||[]).find((row)=>row.userId===user.id&&!row.endAt); return answer('请确认结束本人外勤；结束外勤后仍可继续在店工作，签退时结束本班次。',user,[],{action:{type:'attendance',operation:'fieldwork-end',label:'结束外勤',...(active?{fieldworkId:active.id}:{})}}); }
  if (/(帮我|给我|我要|我想|请)?(签到|签退)(一下|吧)?[。！!？?]?$/.test(question)) { const operation=question.includes('签退')?'checkout':'checkin'; return answer('请确认是否'+(operation==='checkout'?'签退':'签到')+'；确认后才写入本人出勤记录。',user,[],{action:{type:'attendance',operation,label:operation==='checkout'?'确认签退':'确认签到'}}); }
  if (/(开|建|创建|新建|建立).{0,5}接待单/.test(question)) return receptionDraft(user,question);
  if (/(开|建|创建|新建|建立).{0,5}(订货单|采购单)/.test(question)) return c.capabilities(user).purchase ? answer('可以打开订货单，供应商、商品及金额由你核对后提交。',user,[source('订货单','新建','/app?tab=purchase')],{action:{type:'navigate',label:'打开订货单',href:'/app?tab=purchase'}}) : answer('当前岗位没有订货权限。',user);
  if (/(?:向老板|给老板).{0,8}(?:报告|汇报)|我要.{0,4}(?:报告情况|上报情况)/.test(question)) return answer('请把事情、时间和依据写进情况报告；提交后由老板核实。',user,[source('情况报告','填写','/assistant#report-panel')],{action:{type:'navigate',label:'填写情况报告',href:'/assistant#report-panel'}});
  if (/(?:退货|退款|红冲).{0,8}(?:在哪|入口|怎么办|怎么开|办理)|(?:我要|帮我|请).{0,8}(?:退货|红冲)/.test(question)) return c.capabilities(user).returnSale ? answer('从原销售单进入退货办理，费用红冲在收支流水中发起；核对原因和金额后由人提交。',user,[source('原单退货','入口','/app?tab=orders'),source('费用红冲','入口','/app?tab=finance')],{action:{type:'navigate',label:'查原销售单办理售后',href:'/app?tab=orders'}}) : answer('当前岗位没有退货办理权限。',user);
  if (/(?:商品|产品).{0,8}(?:调价|改价)|(?:调价|改价).{0,8}(?:商品|产品)/.test(question)) return c.capabilities(user).manageProducts ? answer('请在商品档案中发起调价，按权限核定并保留价格历史；本单改售价须在销售单核对。',user,[source('商品调价','入口','/app?tab=products')],{action:{type:'navigate',label:'打开商品调价',href:'/app?tab=products'}}) : answer('当前岗位没有商品档案调价权限。',user);
  if (/(能做什么|有什么功能|系统功能|功能清单|怎么使用|怎么开单)/.test(question)) return featureGuide(store,user);
  if (businessIntent(store,question) === 'sale') return saleDraft(store,user,question);
  // Named dated products must be looked up before the general phone-card recommendation flow.
  if(promotionPolicy.isPromotionQuestion(question)||/(?:顺差|直降).{0,12}达量/i.test(question)){
    c.permit(user,'learn');
    const datedPolicy=promotionPolicy.query(store,user,question,(store.employeeKnowledge||[]).filter(row=>row.importBatch==='mobile-promotions-20261010'&&row.enabled!==false));
    if(datedPolicy)return answer(datedPolicy.answer,user,datedPolicy.sources,datedPolicy);
  }
  const products = assistantProducts.query(store,user,question,{customerReplyStyle:payload.customerReplyStyle});
  if (products) return answer(products.answer,user,products.sources,products);
  const tariffs = assistantTariffs.query(store,user,question,{customerReplyStyle:payload.customerReplyStyle,profile:payload.tariffProfile,awaiting:payload.tariffAwaiting});
  if (tariffs) return answer(tariffs.answer,user,tariffs.sources,tariffs);
  const knowledge = employeeKnowledge.query(store,user,question,{customerReplyStyle:payload.customerReplyStyle});
  if (knowledge) return answer(knowledge.answer,user,knowledge.sources,knowledge);
  const supervision = assistantSupervision.query(store,user,question,{date,detail:wantsDetail(question)});
  if (supervision) return answer(supervision.answer,user,supervision.sources,supervision);
  const domain = assistantDomains.query(store,user,question,{date,detail:wantsDetail(question)});
  if (domain) return answer(domain.answer,user,domain.sources,domain);
  if (/(本月|这个月|上个月|上月|本周|这周|上周|最近|近[一二三四五六七八九十\d]+天|这几天|上个星期|今年|全年)/.test(question) && /(销量|销售|卖|营业额|毛利|利润|收款|进货|店况|工作|出勤)/.test(question)) return answer('这项统计目前支持按天查询。请说具体日期；我不会把本周或本月当作今天回答。',user,[],{unsupportedRange:true});
  if (/(收了多少|收到多少钱|收款多少|到账多少|现金收入|今日收款)/.test(question)) {
    if (!c.capabilities(user).finance) return answer('当前岗位没有全店收款查询权限；本人销售收款请到销售单核对。', user);
    const report = erp.report(store,user,date);
    return answer(date + '账套已登记销售收款 ' + money(report.summary.receivedAmount) + '，退款 ' + money(report.summary.refundAmount) + '。仅按系统已确认的收款流水统计，不能代替银行或现金实点。',user,[source('资金流水',date,'/funds'),source('销售日报',date,'/app?tab=dashboard')]);
  }
  if (/(?:赚了多少|赚多少钱|挣了多少|挣多少钱|销售毛利|毛利多少|利润多少|核算.{0,6}毛利)/.test(question)) return profitAnswer(store,user,date,question);
  if (/(?:营业员|员工|店员|销售员).{0,8}销量|销量.{0,8}(?:营业员|员工|店员|销售员)/.test(question) || (/销量|卖.{0,4}(多少|几)|销售额/.test(question) && store.users.some(row=>row.name&&question.includes(row.name)))) {
    const staff=store.users.filter((row)=>row.status==='active' && row.name && question.includes(row.name)).sort((a,b)=>b.name.length-a.name.length)[0];
    if (!staff) return answer('请说营业员的完整姓名，例如“统计一下今天张三营业员的销量”。我会按销售单和退货单统计。',user);
    if (!c.capabilities(user).allSales && staff.id!==user.id) return answer('当前岗位没有查看其他营业员销量的权限。',user);
    return salesVolume(store,user,date,question,staff.id);
  }
  if (/(卖了什么|售出什么|卖了哪些|售出哪些|卖了没有|售出没有|有没有卖|是否卖了)/.test(question)) return salesItemsAnswer(store,user,date,question);
  const businessMeaning = businessIntent(store,question);
  if (businessMeaning === 'sale') return saleDraft(store,user,question);
  if (/(出勤|考勤|签到|签退|到岗|上班人数|下村|外勤)/.test(question)) return attendanceAnswer(store,user,date);
  if (/(打小报告|异常汇报|老板简报|汇报总结|工作总结|日报|今天怎么样|汇报.{0,10}(?:今天|今日).{0,10}(?:店里|店内|门店)|(?:今天|今日).{0,8}(?:店里|店内|门店).{0,8}(?:情况|汇报))/.test(question)) return briefing(store,user,date,question);
  if (businessMeaning === 'inventory') return inventoryAnswer(store,user,question);
  if (/(销量|销售数量|卖出数量|售出数量|(?:卖|售出).{0,6}(?:多少|几).{0,3}(?:台|件|个))/.test(question)) return salesVolume(store,user,date,question);
  if (/(手机|智能机|功能机|二手机)/.test(question) && /(卖|销售|售出|退货|多少台)/.test(question) && /(多少|几台|数量|统计)/.test(question)) return salesVolume(store,user,date,question);
  if (/(销售额|营业额|卖了多少|成交多少|今日经营|今天经营)/.test(question)) return salesSummary(store,user,date,question);
  if (/(毛利|利润|成本)/.test(question)) {
    if (!c.capabilities(user).profit && !c.capabilities(user).cost) return answer('当前岗位没有成本或毛利查看权限。', user);
    if (!c.capabilities(user).profit) return answer('当前岗位没有毛利查看权限；可查询授权范围内的商品成本档案。', user);
    return salesSummary(store,user,date,question);
  }
  if (/(库存|串号|串码|仓库|还有货)/.test(question)) return inventoryAnswer(store,user,question);
  if (/(待办|待审核|待确认|要处理)/.test(question)) {
    const w = workbench.summary(store,user);
    return answer(user.roleCode === 'owner' ? `目前老板待审核与待确认共 ${w.pendingCount} 项：${Object.entries(w.reviews).filter(([,count])=>count).map(([key,count])=>`${key} ${count}项`).join('；') || '暂无'}。请到工作台逐项核对。` : `你当前待处理 ${w.pendingCount} 项，其中到期回访 ${w.followups} 项、待确认销售款 ${w.salePaymentsToConfirm} 项、待验收订货 ${w.assignedPlans} 项。`, user, [source('工作台待办','待办','/m')]);
  }
  return generalSearch(store,user,question);
}
function ask(store,user,payload) {
  const spoken=c.text(payload.question,'问题');
  if(spoken.length>1500)throw new c.HttpError(400,'问题不能超过1500字');
  if(payload.mode!==undefined&&!['store','customer'].includes(payload.mode))throw new c.HttpError(400,'请选择店内或顾客模式');
  const mode=user.assistantCustomerOnly===true||user.roleCode==='customer-assistant'?'customer':payload.mode||'store';
  const context=mode==='customer'?(payload.context?.mode==='customer'?payload.context:null):(payload.context?.mode==='customer'?null:payload.context);
  const clock=assistantClock.query(spoken,{context:context?.userId===user.id&&context.mode===mode?context.clock:null});
  if(clock)return {...answer(clock.answer,user,[],clock),mode,context:{...assistantContext.create(spoken,user,clock),mode,clock:clock.metrics.clockContext},followups:[]};
  const resolved=assistantContext.resolve(spoken,context,user);
  const request={...payload,question:resolved.question,tariffProfile:resolved.profile,tariffAwaiting:resolved.awaiting,dialogueAnswered:resolved.dialogueAnswered,dialoguePool:resolved.dialoguePool};
  const result=mode==='customer'?assistantCustomer.query(store,user,request):assistantDialogue.customize(store,askOnce(store,user,request),payload.customerReplyStyle,{answered:resolved.dialogueAnswered||[],pool:resolved.dialoguePool});
  const followups=(Array.isArray(result.followups)?result.followups:assistantContext.followups(resolved.question,result)).slice(0,8).map(row=>typeof row==='string'?{label:row,question:row}:row).filter(row=>row&&typeof row.question==='string'&&row.question.length<=240).map(row=>({label:String(row.label||row.question).slice(0,60),question:row.question}));
  return {...result,mode,context:{...assistantContext.create(resolved.question,user,result),mode},followups};
}
module.exports = { ask, attendance, getAttendance, tickAttendanceSpotChecks, submitReport, reports, reviewReport };


