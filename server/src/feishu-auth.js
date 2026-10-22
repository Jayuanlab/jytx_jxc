const { HttpError } = require("./common");

const API = "https://open.feishu.cn/open-apis";

async function feishuJson(path, options = {}) {
  let response;
  try {
    response = await fetch(API + path, { ...options, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new HttpError(502, "飞书登录服务暂不可用，请稍后重试");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 0)
    throw new HttpError(502, "飞书登录验证失败，请稍后重试");
  return body;
}

async function getUserFromCode(code, appId, appSecret) {
  const app = await feishuJson("/auth/v3/app_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const token = await feishuJson("/authen/v1/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${app.app_access_token}`,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const info = await feishuJson("/authen/v1/user_info", {
    headers: { Authorization: `Bearer ${token.data.access_token}` },
  });
  if (!info.data?.open_id) throw new HttpError(502, "飞书未返回员工身份");
  return { openId: info.data.open_id, name: info.data.name || "" };
}

function authorizationUrl(appId, redirectUri, state) {
  const url = new URL(API + "/authen/v1/index");
  url.search = new URLSearchParams({ app_id: appId, redirect_uri: redirectUri, state }).toString();
  return url.toString();
}

module.exports = { getUserFromCode, authorizationUrl };
