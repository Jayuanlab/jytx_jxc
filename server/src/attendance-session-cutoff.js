'use strict';
// The existing PG session issuer fixes expires_at to issue time + eight hours.
// Keep the source guard on that issuer until sessions have an explicit issued_at column.
const LIFETIME_MS=28800000;
function revoked(session,cutoffs){const raw=cutoffs?.[session?.user_id||session?.userId];if(!raw)return false;const cutoff=Date.parse(raw),issued=Number(session.issuedAt??session.issued_at??((session.expires_at??session.expiresAt)-LIFETIME_MS));return Number.isFinite(cutoff)&&(!Number.isFinite(issued)||issued<=cutoff);}
function record(store,userId,at){if(!userId||!Number.isFinite(Date.parse(at)))throw Error('Invalid checkout session cutoff');store.attendanceSessionCutoffs||={};const previous=Date.parse(store.attendanceSessionCutoffs[userId]);if(!Number.isFinite(previous)||Date.parse(at)>previous)store.attendanceSessionCutoffs[userId]=at;}
function wrapAttendance(original){return function(store,user,payload){const result=original(store,user,payload);if(payload?.action==='checkout'&&result?.feedback?.recorded===true&&result.userId===user.id)record(store,user.id,result.feedback.eventAt);return result;};}
module.exports={revoked,record,wrapAttendance};
