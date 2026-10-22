'use strict';
const c = require('./common'), context = require('./capacity/context');
const DAY = 86400000;
const LOCATION_POLICY = Object.freeze({coordinateSystem: 'WGS84', maxAccuracyMeters: 100, maxAgeSeconds: 300, maxFutureSeconds: 60});
const finiteTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00+08:00')) && c.day(value + 'T00:00:00+08:00') === value;
function periodFor(month) {
  c.validMonth(month);
  const year = Number(month.slice(0, 4)), number = Number(month.slice(5));
  if (year < 1000) throw new c.HttpError(400, '月份不正确');
  const startDate = month + '-01', start = Date.parse(startDate + 'T00:00:00+08:00');
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate(), endDate = month + '-' + String(count).padStart(2, '0');
  return {month, startDate, endDate, start, end: start + count * DAY};
}
function merge(intervals) {
  const sorted = intervals.filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && to > from).map(row => [...row]).sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const row of sorted) {
    const previous = result[result.length - 1];
    if (previous && row[0] <= previous[1]) previous[1] = Math.max(previous[1], row[1]);
    else result.push(row);
  }
  return result;
}
const seconds = intervals => Math.floor(merge(intervals).reduce((sum, [from, to]) => sum + to - from, 0) / 1000);
function humanReview(value, now) {
  if (!value || !['confirmed', 'needs-followup'].includes(value.decision) || typeof value.reviewerId !== 'string' || !value.reviewerId || !Number.isFinite(finiteTime(value.reviewedAt)) || finiteTime(value.reviewedAt) > now) return null;
  return {decision: value.decision, note: String(value.note || ''), reviewedAt: value.reviewedAt, reviewerId: value.reviewerId, reviewerName: String(value.reviewerName || '')};
}
function classifyLocation(location, eventAt, context, now = Date.now()) {
  const review = humanReview(location?.humanReview, now), result = {outcome: 'uncertain', reason: 'historical-missing', distanceMeters: null, accuracyMeters: null, radiusMeters: null, humanReview: review};
  const evidence = location?.evidence, recorded = finiteTime(location?.recordedAt || eventAt);
  const coordinate = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!evidence) result.reason = !location || location.reason === 'historical-missing' ? 'historical-missing' : location.failure === 'permission-denied' ? 'permission-denied' : 'no-location';
  else if (!coordinate(evidence.latitude, -90, 90) || !coordinate(evidence.longitude, -180, 180) || !coordinate(evidence.accuracy, 0, 100000) || !Number.isFinite(finiteTime(evidence.capturedAt)) || !Number.isFinite(recorded) || (location.coordinateSystem && location.coordinateSystem !== 'WGS84') || (evidence.coordinateSystem && evidence.coordinateSystem !== 'WGS84')) result.reason = 'invalid-evidence';
  else {
    result.accuracyMeters = evidence.accuracy;
    const age = recorded - finiteTime(evidence.capturedAt);
    if (age < -LOCATION_POLICY.maxFutureSeconds * 1000) result.reason = 'future';
    else if (age > LOCATION_POLICY.maxAgeSeconds * 1000) result.reason = 'stale';
    else if (evidence.accuracy > LOCATION_POLICY.maxAccuracyMeters) result.reason = 'low-accuracy';
    else if (context === 'fieldwork') { result.outcome = 'fieldwork'; result.reason = 'fieldwork-recorded'; }
    else {
      const settings = location.settingsSnapshot;
      if (!settings || settings.configured !== true || !coordinate(settings.latitude, -90, 90) || !coordinate(settings.longitude, -180, 180) || !coordinate(settings.radiusMeters, 20, 5000) || !Number.isInteger(settings.radiusMeters) || (settings.coordinateSystem && settings.coordinateSystem !== 'WGS84')) result.reason = 'settings-missing';
      else {
        const radians = n => n * Math.PI / 180, dLat = radians(evidence.latitude - settings.latitude), dLon = radians(evidence.longitude - settings.longitude);
        const a = Math.min(1, Math.max(0, Math.sin(dLat / 2) ** 2 + Math.cos(radians(settings.latitude)) * Math.cos(radians(evidence.latitude)) * Math.sin(dLon / 2) ** 2));
        const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        result.distanceMeters = Math.round(distance * 100) / 100; result.radiusMeters = settings.radiusMeters;
        if (distance + evidence.accuracy <= settings.radiusMeters) { result.outcome = 'inside'; result.reason = 'inside'; }
        else if (distance - evidence.accuracy > settings.radiusMeters) { result.outcome = 'outside'; result.reason = 'outside'; }
        else result.reason = 'boundary-uncertain';
      }
    }
  }
  result.needsReview = review?.decision === 'needs-followup' || (['uncertain', 'outside'].includes(result.outcome) && review?.decision !== 'confirmed');
  return result;
}
const reasonText = { 'historical-missing': '旧记录没有定位证据', 'no-location': '未取得手机定位', 'permission-denied': '手机未允许定位', 'invalid-evidence': '定位原始证据不完整或格式异常', 'settings-missing': '当时没有有效门店坐标设置', future: '定位采集时间超前', stale: '定位证据在打卡时已过期', 'low-accuracy': '手机定位精度不足', 'boundary-uncertain': '定位误差范围跨门店边界', outside: '手机定位显示在门店范围外', inside: '手机定位及精度范围在店内', 'fieldwork-recorded': '外勤定位已记录，不要求在门店内' };
function report(store, user, month = c.month(), {at = c.now()} = {}) {
  const actor = c.userById(store, user?.id);
  if (actor.assistantCustomerOnly === true || !['owner', 'manager', 'employee', 'warehouse'].includes(actor.roleCode)) throw new c.HttpError(403, '考勤报告只供门店员工查看');
  const period = periodFor(month), now = finiteTime(at);
  if (!Number.isFinite(now)) throw new c.HttpError(400, '报告时钟不正确');
  const today = c.day(at), privileged = ['owner', 'manager'].includes(actor.roleCode);
  const branchId = context.current()?.branchId || null;
  const users = new Map((store.users || []).map(row => [row.id, row]));
  const inBranch = member => !branchId || !member || member.roleCode === 'owner' || member.branchIds == null || (Array.isArray(member.branchIds) && member.branchIds.includes(branchId));
  const staffMember = member => !member || (member.assistantCustomerOnly !== true && ['owner', 'manager', 'employee', 'warehouse'].includes(member.roleCode));
  if (!inBranch(actor)) throw new c.HttpError(403, '当前账号不属于此门店');
  const visible = id => (privileged || id === actor.id) && staffMember(users.get(id)) && inBranch(users.get(id));
  const nameFor = (id, fallback) => String(users.get(id)?.name || fallback || '历史员工');
  const days = new Map(), allIssues = [], shifts = [], ids = new Map(), parents = new Map();
  for (const row of store.attendance || []) if (visible(row.userId)) parents.set(row.id, parents.has(row.id) ? null : row);
  const inMonth = date => validDate(date) && date.startsWith(month + '-');
  function dayFor(userId, date, name) {
    const key = userId + '/' + date;
    if (!days.has(key)) days.set(key, {date, userId, name: nameFor(userId, name), status: 'normal', closedWorkSeconds: 0, fieldworkSeconds: 0, isWorking: false, workingCount: 0, missingCheckoutCount: 0, locationPendingCount: 0, spotCheckUnansweredCount: 0, spotCheckOverdueCount: 0, late: null, early: null, absence: null, issues: [], locations: [], attendanceIds: [], _closed: [], _fieldwork: [], _unverified: [], _attended: false});
    return days.get(key);
  }
  function issue(userId, date, name, code, message, recommendation, extra = {}) {
    const row = {userId, name: nameFor(userId, name), date, code, message, recommendation, needsReview: true, ...extra};
    allIssues.push(row);
    if (inMonth(date)) dayFor(userId, date, name).issues.push(row);
    return row;
  }
  function includeRow(day, row) { if (!day.attendanceIds.includes(row.id)) day.attendanceIds.push(row.id); }
  function segments(start, end, callback) {
    let from = Math.max(start, period.start), limit = Math.min(end, period.end);
    while (Number.isFinite(from) && from < limit) {
      const date = c.day(from), midnight = Date.parse(date + 'T00:00:00+08:00'), to = Math.min(limit, midnight + DAY);
      callback(date, from, to); from = to;
    }
  }
  function locationPoint(row, event, source, eventAt, context, extra = {}, anchorDate = null, forceLate = false) {
    const date = anchorDate || (Number.isFinite(finiteTime(eventAt)) ? c.day(eventAt) : validDate(row.date) ? row.date : null);
    if (!inMonth(date) || !Number.isFinite(finiteTime(eventAt)) || finiteTime(eventAt) > now) return;
    const classification = classifyLocation(source, eventAt, context, now), review = classification.humanReview;
    if (forceLate && review?.decision !== 'confirmed') classification.needsReview = true;
    const point = {event, at: eventAt, eventDate: c.day(eventAt), recordId: extra.recordId || row.id, attendanceId: extra.attendanceId || row.id, context, ...extra, ...classification, late: forceLate};
    const day = dayFor(row.userId, date, row.name); day.locations.push(point);
    if (classification.needsReview) day.locationPendingCount++;
    if (['outside', 'uncertain'].includes(classification.outcome) || forceLate || review?.decision === 'needs-followup') {
      const code = forceLate ? 'spot-check-late' : review?.decision === 'needs-followup' ? 'location-human-followup' : 'location-' + classification.reason;
      issue(row.userId, date, row.name, code, forceLate ? '自动抽查超过回应时限；保留本次客观位置判定' : reasonText[classification.reason] || '定位证据需核对', review?.decision === 'confirmed' ? '已人工核对；原手机定位证据和自动结果仍保留' : '查看原始打卡、定位或外勤记录并核对原因，不能仅据定位推断旷工', {...extra, attendanceId: extra.attendanceId || row.id, event, recordId: point.recordId, locationOutcome: classification.outcome, humanReview: review, needsReview: classification.needsReview});
    }
  }
  for (const row of store.attendance || []) {
    if (!visible(row.userId)) continue;
    const start = finiteTime(row.checkInAt), end = finiteTime(row.checkOutAt), date = Number.isFinite(start) ? c.day(start) : validDate(row.date) ? row.date : null;
    const intersects = Number.isFinite(start) && (row.checkOutAt ? Number.isFinite(end) && end > period.start && start < period.end : inMonth(date));
    if (!inMonth(date) && !intersects) continue;
    if (ids.has(row.id)) { if (inMonth(date)) issue(row.userId, date, row.name, 'duplicate-attendance-id', '签到记录编号重复', '核对重复记录来源，报告不重复累计相同时间', {attendanceId: row.id}); }
    else ids.set(row.id, row);
    const shift = {row, start, end, date, closed: !!row.checkOutAt && Number.isFinite(start) && Number.isFinite(end) && end >= start && end <= now}; shifts.push(shift);
    if (inMonth(date)) {
      const day = dayFor(row.userId, date, row.name); includeRow(day, row);
      if (Number.isFinite(start) && start <= now) day._attended = true;
      if (!Number.isFinite(start) || start > now) issue(row.userId, date, row.name, 'invalid-checkin-time', '签到时间无效或晚于报告时间', '核对原签到时间，不补算工作时长', {attendanceId: row.id});
      if (validDate(row.date) && row.date !== date) issue(row.userId, date, row.name, 'attendance-date-mismatch', '签到日期与实际签到时间不一致', '按原始时间核对记录；月报不改原签到日期', {attendanceId: row.id, sourceDate: row.date});
      if (row.checkOutAt && !shift.closed) issue(row.userId, date, row.name, 'invalid-checkout-time', '签退时间无效、早于签到或晚于报告时间', '核对原签退记录，异常段不计入闭合时长', {attendanceId: row.id});
      if (!row.checkOutAt && Number.isFinite(start) && start <= now) {
        if (date === today) { day.isWorking = true; day.workingCount++; }
        else { day.missingCheckoutCount++; issue(row.userId, date, row.name, 'missing-checkout', '历史签到尚未签退，不能一直累计到现在', '核对是否漏签退或存在跨日外勤；不直接判旷工、不自动扣薪', {attendanceId: row.id}); }
      }
    }
    if (shift.closed) segments(start, end, (date, from, to) => {const day = dayFor(row.userId, date, row.name); day._attended = true; includeRow(day, row); day._closed.push([from, to]); if (end - start > DAY) { day._unverified.push([from, to]); issue(row.userId, date, row.name, 'long-continuous-shift', '连续班次超过24小时，保留记录时长但列为待核', '核对是否漏签退后补签或真实跨日任务；此筛查线索不等于旷工，也不自动用于工资', {attendanceId: row.id, continuousSeconds: Math.floor((end - start) / 1000)}); }});
    locationPoint(row, 'checkin', row.checkInLocation, row.checkInAt, row.checkInLocation?.context === 'fieldwork' ? 'fieldwork' : 'store');
    if (row.checkOutAt) locationPoint(row, 'checkout', row.checkOutLocation, row.checkOutAt, row.checkOutLocation?.context === 'fieldwork' ? 'fieldwork' : 'store');
    for (const supplement of row.locationSupplements || []) locationPoint(row, 'supplement', supplement.locationReport, supplement.at, supplement.locationReport?.context === 'fieldwork' ? 'fieldwork' : 'store', {recordId: supplement.id, supplementId: supplement.id, laterEvidence: true});
  }
  const byUser = new Map();
  for (const shift of shifts.filter(s => s.closed && s.end > s.start)) {if (!byUser.has(shift.row.userId)) byUser.set(shift.row.userId, []); byUser.get(shift.row.userId).push(shift);}
  for (const list of byUser.values()) {
    list.sort((a, b) => a.start - b.start);
    const overlapping = new Set();
    for (let i = 1; i < list.length; i++) for (let j = 0; j < i; j++) if (list[j].end > list[i].start) {overlapping.add(list[j]); overlapping.add(list[i]);}
    for (const shift of overlapping) segments(shift.start, shift.end, (date, from, to) => {
      const row = shift.row, day = dayFor(row.userId, date, row.name); day._unverified.push([from, to]);
      issue(row.userId, date, row.name, 'overlapping-shifts', '闭合班次时间重叠，报告按并集合并并列为待核', '核对重复签到或班次关系，不能将重叠时间重复计工时', {attendanceId: row.id});
    });
  }
  for (const work of store.attendanceFieldwork || []) {
    if (!visible(work.userId)) continue;
    const parent = parents.get(work.attendanceId), shift = shifts.find(s => s.row.id === work.attendanceId && s.row.userId === work.userId) || (parent && {row: parent, start: finiteTime(parent.checkInAt), end: finiteTime(parent.checkOutAt), closed: !!parent.checkOutAt && Number.isFinite(finiteTime(parent.checkInAt)) && Number.isFinite(finiteTime(parent.checkOutAt)) && finiteTime(parent.checkOutAt) >= finiteTime(parent.checkInAt) && finiteTime(parent.checkOutAt) <= now}), start = finiteTime(work.startAt), end = finiteTime(work.endAt);
    const date = Number.isFinite(start) ? c.day(start) : validDate(work.date) ? work.date : null;
    if (!shift && !inMonth(date)) continue;
    if (!parent || parent.userId !== work.userId) {if (inMonth(date)) issue(work.userId, date, work.name, 'fieldwork-parent-missing', '外勤没有唯一匹配的本人签到记录', '核对外勤关联班次，不能额外增加工作时长', {fieldworkId: work.id, attendanceId: work.attendanceId}); continue;}
    if (!Number.isFinite(start) || start > now || work.endAt && (!Number.isFinite(end) || end < start || end > now)) {
      if (inMonth(date)) issue(work.userId, date, work.name, 'invalid-fieldwork-time', '外勤开始或结束时间异常', '核对原外勤记录，异常段不计入闭合外勤时长', {fieldworkId: work.id, attendanceId: parent.id});
    } else if (!work.endAt && shift.closed) {
      if (inMonth(date)) issue(work.userId, date, work.name, 'fieldwork-missing-end', '已签退班次仍有未结束外勤', '核对外勤结束记录，不推测结束时间', {fieldworkId: work.id, attendanceId: parent.id});
    } else if (shift.closed && work.endAt) {
      if (start < shift.start || end > shift.end) {if (inMonth(date)) issue(work.userId, date, work.name, 'fieldwork-outside-shift', '外勤区间超出关联班次，报告已裁剪', '核对外勤和签到时段，外勤不能叠加到班次之外', {fieldworkId: work.id, attendanceId: parent.id});}
      segments(Math.max(start, shift.start), Math.min(end, shift.end), (date, from, to) => {const day = dayFor(work.userId, date, work.name); includeRow(day, parent); day._fieldwork.push([from, to]);});
    }
    locationPoint(parent, 'fieldwork-start', work.startLocation, work.startAt, 'fieldwork', {fieldworkId: work.id, recordId: work.id});
    if (work.endAt) locationPoint(parent, 'fieldwork-end', work.endLocation, work.endAt, 'fieldwork', {fieldworkId: work.id, recordId: work.id});
    for (const point of work.checkpoints || []) locationPoint(parent, 'checkpoint', point.locationReport, point.at, 'fieldwork', {fieldworkId: work.id, checkpointId: point.id, recordId: point.id});
  }
  for (const request of store.attendanceLocationRequests || []) {
    if (!visible(request.userId)) continue;
    const date = validDate(request.date) ? request.date : Number.isFinite(finiteTime(request.createdAt)) ? c.day(request.createdAt) : null;
    if (!inMonth(date) || finiteTime(request.createdAt) > now) continue;
    const day = dayFor(request.userId, date, request.name), due = finiteTime(request.dueAt), responded = finiteTime(request.respondedAt);
    if (request.status === 'cancelled') continue;
    if (!request.respondedAt) {
      day.spotCheckUnansweredCount++;
      if (!Number.isFinite(due)) issue(request.userId, date, request.name, 'spot-check-invalid-deadline', '抽查回应时限无效', '核对原任务时间，不推断员工是否逾期', {requestId: request.id, attendanceId: request.attendanceId});
      else if (now > due) {day.spotCheckOverdueCount++; issue(request.userId, date, request.name, 'spot-check-unanswered', '自动抽查已超过时限仍未回应', '查看当时是否在店、外勤或设备异常；未回应不能直接判旷工', {requestId: request.id, attendanceId: request.attendanceId});}
    } else if (!Number.isFinite(responded) || responded > now || !Number.isFinite(due)) {
      issue(request.userId, date, request.name, 'spot-check-invalid-response-time', '抽查回应时间或时限异常', '核对原抽查记录，不编造逾期结论', {requestId: request.id, attendanceId: request.attendanceId});
    } else {
      const parent = parents.get(request.attendanceId), row = parent && parent.userId === request.userId ? parent : {id: request.attendanceId, userId: request.userId, name: request.name, date};
      locationPoint(row, 'spot-check', request.responseLocation, request.respondedAt, request.responseLocation?.context === 'fieldwork' ? 'fieldwork' : 'store', {recordId: request.id, requestId: request.id, attendanceId: request.attendanceId}, date, responded > due);
    }
  }
  const employeeMap = new Map();
  function employee(id, name) {if (!employeeMap.has(id)) employeeMap.set(id, {userId: id, name: nameFor(id, name), attendedDays: 0, closedWorkSeconds: 0, fieldworkSeconds: 0, unverifiedClosedWorkSeconds: 0, normalClosedWorkSeconds: 0, workingCount: 0, missingCheckoutCount: 0, locationPendingCount: 0, spotCheckUnansweredCount: 0, spotCheckOverdueCount: 0, needsReviewDays: 0, late: null, early: null, absence: null}); return employeeMap.get(id);}
  if (privileged) { for (const member of users.values()) if (member.status === 'active' && member.roleCode !== 'owner' && visible(member.id)) employee(member.id, member.name); }
  else employee(actor.id, actor.name);
  const publicDays = [...days.values()].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'zh-CN')).map(day => {
    day.closedWorkSeconds = seconds(day._closed); day.fieldworkSeconds = seconds(day._fieldwork); day.unverifiedClosedWorkSeconds = seconds(day._unverified); day.normalClosedWorkSeconds = day.closedWorkSeconds - day.unverifiedClosedWorkSeconds;
    day.status = day.issues.some(row => row.needsReview) ? 'needs-review' : 'normal';
    const outcomes = [...new Set(day.locations.map(point => point.outcome))]; day.locationOutcome = outcomes.length === 1 ? outcomes[0] : outcomes.length ? 'mixed' : 'none';
    if (day.attendanceIds.length === 1) day.attendanceId = day.attendanceIds[0];
    const e = employee(day.userId, day.name); e.attendedDays += day._attended ? 1 : 0;
    for (const key of ['closedWorkSeconds', 'fieldworkSeconds', 'unverifiedClosedWorkSeconds', 'normalClosedWorkSeconds', 'workingCount', 'missingCheckoutCount', 'locationPendingCount', 'spotCheckUnansweredCount', 'spotCheckOverdueCount']) e[key] += day[key];
    e.needsReviewDays += day.status === 'needs-review' ? 1 : 0;
    const {_closed, _fieldwork, _unverified, _attended, ...result} = day; return result;
  });
  const employees = [...employeeMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const summary = {employees: employees.length, attendedDays: 0, closedWorkSeconds: 0, fieldworkSeconds: 0, unverifiedClosedWorkSeconds: 0, normalClosedWorkSeconds: 0, workingCount: 0, missingCheckoutCount: 0, locationPendingCount: 0, spotCheckUnansweredCount: 0, spotCheckOverdueCount: 0, needsReviewDays: 0, late: null, early: null, absence: null};
  for (const e of employees) for (const key of ['attendedDays', 'closedWorkSeconds', 'fieldworkSeconds', 'unverifiedClosedWorkSeconds', 'normalClosedWorkSeconds', 'workingCount', 'missingCheckoutCount', 'locationPendingCount', 'spotCheckUnansweredCount', 'spotCheckOverdueCount', 'needsReviewDays']) summary[key] += e[key];
  const recommendations = [];
  if (summary.missingCheckoutCount) recommendations.push('先核对历史漏签退或跨日外勤记录；月报没有把未签退时间一直累计到现在。');
  if (summary.locationPendingCount) recommendations.push('优先核对范围外、精度不足或未获定位权限的点；范围内正常记录已自动归类，无需逐条确认。');
  if (summary.spotCheckOverdueCount) recommendations.push('核对逾期未回应抽查时的外勤、网络和定位情况，不直接作旷工或扣薪依据。');
  if (allIssues.some(row => /overlapping|outside-shift|parent-missing|invalid-.*time|date-mismatch/.test(row.code))) recommendations.push('核对重复班次、时间异常和外勤关联；时长已合并重叠并裁剪到实际闭合班次和本月。');
  if (summary.unverifiedClosedWorkSeconds) recommendations.push('超24小时连续班次或重叠班次已单列待核时长，不能把它当作已核准的工作时长。');
  for (const e of employees.filter(e => e.needsReviewDays).slice(0, 5)) {
    const reasons = [e.missingCheckoutCount ? e.missingCheckoutCount + '条历史未签退' : '', e.locationPendingCount ? e.locationPendingCount + '个定位点待核' : '', e.spotCheckOverdueCount ? e.spotCheckOverdueCount + '条抽查逾期未回应' : '', e.unverifiedClosedWorkSeconds ? '闭合时长中有待核班次' : ''].filter(Boolean);
    recommendations.unshift(e.name + '：' + (reasons.length ? reasons.join('、') : e.needsReviewDays + '个日期记录待核') + '；请查看对应日期原始记录。');
  }
  if (!summary.attendedDays) recommendations.unshift('本月暂无有效签到或闭合工作片段，不能判定出勤或缺勤。');
  else if (!recommendations.length) recommendations.push('本月已记录数据未发现待核对异常；正常范围内定位已自动归类，无需逐条确认。');
  const durationText = n => Math.floor(n / 3600) + '小时' + Math.floor(n % 3600 / 60) + '分钟';
  return {period: {month, startDate: period.startDate, endDate: period.endDate}, asOf: at, privileged, summary, employees, days: publicDays, issues: allIssues,
    analysis: {summary: summary.attendedDays ? `本月记录 ${summary.attendedDays} 人天；闭合工作记录 ${durationText(summary.closedWorkSeconds)}（其中待核 ${durationText(summary.unverifiedClosedWorkSeconds)}），已包含闭合外勤 ${durationText(summary.fieldworkSeconds)}；${summary.needsReviewDays} 个员工日期有待核对事项。` : '本月暂无有效签到或闭合工作片段，不能判定出勤或缺勤。', recommendations},
    settings: {scheduleConfigured: false, continuousShiftReviewHours: 24, coordinateSystem: 'WGS84', locationPolicy: {...LOCATION_POLICY}, usesHistoricalLocationSettings: true},
    limitations: ['未设置有效排班、休息日和宽限规则，迟到、早退、旷工均不作判定；无签到记录不等于缺勤。', '出勤天数是有签到或闭合跨日工作片段的不同日期；总览是员工人天之和。', '连续超过24小时或相互重叠的班次单列待核时长，阈值仅作筛查线索，不代表核薪结论。', '只统计已闭合班次；今日进行中或历史未签退均不估计工时。未签退归签到所在月。', '外勤只计有结束时间且在闭合关联班次内的区间，重叠按并集合并，已包含在工作总时长中。', '定位按当时设置快照和精度范围判定，手机定位不证明实际到店，也不防定位伪造；外勤不要求在门店。', '补定位只说明后来的位置，不覆盖或证明首次签到位置；人工核对单独标示，不改自动证据。', '本报告为确定性事实统计，不调用模型、不生成评分、不自动修改工资或经营数据。']};
}
module.exports = {report, classifyLocation, merge, periodFor};