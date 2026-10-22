process.env.NODE_ENV = 'test';
process.env.STORE_DB_PATH = ':memory:';
process.env.STORE_AUTH_DB_PATH = ':memory:';
process.env.STORE_CREDENTIALS_DB_PATH = ':memory:';
process.env.STORE_SEED_PATH = require('node:path').join(__dirname, '..', '..', 'examples', 'test-store.json');
process.env.FEISHU_APP_ID = 'cli_test';
process.env.FEISHU_APP_SECRET = 'secret_for_test';
process.env.FEISHU_PUBLIC_ORIGIN = 'http://127.0.0.1';
process.env.FEISHU_BOOTSTRAP_TOKEN = 'bootstrap_for_test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./application');
const { close: closeCredentials } = require('./local-credentials');
const { close: closeSessions } = require('./auth-sessions');
const originalFetch = global.fetch;
global.fetch = (url) => {
  const target = String(url);
  if (!target.startsWith('https://open.feishu.cn/open-apis/')) return originalFetch(url);
  if (target.endsWith('/app_access_token/internal')) return Promise.resolve(Response.json({ code: 0, app_access_token: 'app_token' }));
  if (target.endsWith('/authen/v1/access_token')) return Promise.resolve(Response.json({ code: 0, data: { access_token: 'user_token' } }));
  if (target.endsWith('/authen/v1/user_info')) return Promise.resolve(Response.json({ code: 0, data: { open_id: 'ou_local_owner', name: '测试老板' } }));
  throw new Error('Unexpected Feishu URL');
};
test('正式账号密码登录、员工重置和锁定', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (path, data, cookie) => originalFetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(data),
  });
  try {
    assert.equal((await originalFetch(base + '/login')).status, 200);
    assert.equal((await originalFetch(base + '/login.js')).status, 200);
    assert.equal((await post('/api/auth/local/login', { username: '老板', password: 'wrongwrong' })).status, 401);
    const start = await originalFetch(base + '/api/auth/feishu/start?setup=bootstrap_for_test', { redirect: 'manual' });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const oauthCookie = start.headers.get('set-cookie').split(';')[0];
    const callback = await originalFetch(base + '/api/auth/feishu/callback?code=unit-code&state=' + state,
      { redirect: 'manual', headers: { Cookie: oauthCookie } });
    assert.equal(callback.status, 302);
    const ownerCookie = callback.headers.get('set-cookie').split(';')[0];
    const ownerSetup = await post('/api/auth/local/self-set', {
      username: '老板', password: 'OwnerPass987654', repeat: 'OwnerPass987654',
    }, ownerCookie);
    assert.equal(ownerSetup.status, 200);
    const ownerLogin = await post('/api/auth/local/login', { username: '老板', password: 'OwnerPass987654' });
    assert.equal(ownerLogin.status, 200);
    const passwordCookie = ownerLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await originalFetch(base + '/api/me', { headers: { Cookie: passwordCookie } })).status, 200);
    const issuedResponse = await post('/api/auth/local/admin-set', { userId: 'demo-clerk', username: '店员甲' }, passwordCookie);
    assert.equal(issuedResponse.status, 200);
    const issued = await issuedResponse.json();
    assert.equal(issued.password.length, 20);
    const clerkLogin = await post('/api/auth/local/login', { username: '店员甲', password: issued.password });
    assert.equal(clerkLogin.status, 200);
    const clerkCookie = clerkLogin.headers.get('set-cookie').split(';')[0];
    const clerkMe = await (await originalFetch(base + '/api/me', { headers: { Cookie: clerkCookie } })).json();
    assert.equal(clerkMe.roleCode, 'employee');
    const resetResponse = await post('/api/auth/local/admin-set', { userId: 'demo-clerk', username: '店员甲' }, passwordCookie);
    assert.equal(resetResponse.status, 200);
    assert.equal((await originalFetch(base + '/api/me', { headers: { Cookie: clerkCookie } })).status, 401);
    assert.equal((await post('/api/auth/local/login', { username: '店员甲', password: issued.password })).status, 401);
    for (let i = 0; i < 5; i++) await post('/api/auth/local/login', { username: '店员甲', password: 'badpassword' });
    const locked = await post('/api/auth/local/login', { username: '店员甲', password: (await resetResponse.json()).password });
    assert.equal(locked.status, 401);
    assert.match((await locked.json()).error.message, /暂锁/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeCredentials();
    closeSessions();
    global.fetch = originalFetch;
  }
});

