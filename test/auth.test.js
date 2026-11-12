const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const root = path.resolve(__dirname, '..');
const secret = 'integration-test-secret-only-not-for-production-123456';

async function start(dataDir, extra = {}) {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development', SESSION_SECRET: secret,
      DATA_DIR: dataDir, PORT: String(port), ...extra },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Startup timed out: ' + logs)); }, 15000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Startup failed ' + code + ': ' + logs)); });
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('server running')) { clearTimeout(timeout); resolve(); }
    });
  });
  return {
    child,
    request: (url, options) => fetch(`http://127.0.0.1:${port}${url}`, options),
    stop: async () => {
      if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    }
  };
}
const post = (body, cookie) => ({ method: 'POST', headers: {
  'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {})
}, body: JSON.stringify(body) });
const cookieFrom = response => response.headers.get('set-cookie')?.split(';')[0];

test('registration, login, protected page, restart persistence and logout', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm1-auth-'));
  let server;
  t.after(async () => { await server?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  server = await start(dir);
  assert.equal((await server.request('/dashboard')).status, 401);
  assert.equal((await server.request('/')).status, 200);
  for (const asset of ['/script.js', '/styles.css']) assert.equal((await server.request(asset)).status, 200);
  let response = await server.request('/api/auth/register', post({ identifier: 'TestUser', password: 'StrongPass123!' }));
  assert.equal(response.status, 201);
  const cookie = cookieFrom(response);
  assert.ok(cookie);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await response.json()).user.identifier, 'testuser');
  assert.equal((await server.request('/dashboard', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await server.request('/api/auth/register', post({ identifier: 'TESTUSER', password: 'StrongPass123!' }))).status, 409);
  assert.equal((await server.request('/api/auth/login', post({ identifier: 'testuser', password: 'incorrect' }))).status, 401);
  assert.equal((await server.request('/api/auth/register', post({ identifier: 'other', password: 'short' }))).status, 400);
  await server.stop();
  const db = new Database(path.join(dir, 'app.sqlite'), { readonly: true });
  const row = db.prepare('SELECT * FROM users').get();
  assert.notEqual(row.password_hash, 'StrongPass123!');
  assert.ok(bcrypt.compareSync('StrongPass123!', row.password_hash));
  db.close();
  server = await start(dir);
  response = await server.request('/api/auth/me', { headers: { Cookie: cookie } });
  assert.equal((await response.json()).user.identifier, 'testuser');
  response = await server.request('/api/auth/login', post({ identifier: 'TESTUSER', password: 'StrongPass123!' }));
  assert.equal(response.status, 200);
  const loginCookie = cookieFrom(response);
  assert.equal((await server.request('/api/auth/logout', post({}, loginCookie))).status, 204);
  assert.equal((await server.request('/dashboard', { headers: { Cookie: loginCookie } })).status, 401);
});

test('private files, archives and custom data directories are never public', async t => {
  const dir = fs.mkdtempSync(path.join(root, 'private-test-'));
  fs.writeFileSync(path.join(dir, 'private.txt'), 'private data');
  const server = await start(dir);
  t.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  for (const file of ['/server.js', '/package.json', '/.env', '/dashboard.html', '/data/app.sqlite',
    '/457vwpcdx.zip', '/' + path.basename(dir) + '/private.txt', '/test/auth.test.js']) {
    assert.equal((await server.request(file)).status, 404, file);
  }
});

test('bcrypt passwords exceeding 72 UTF-8 bytes are rejected', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm1-bytes-'));
  const server = await start(dir);
  t.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await server.request('/api/auth/register', post({ identifier: 'arabicuser', password: 'ع'.repeat(37) }))).status, 400);
});

test('repeated authentication attempts are limited', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm1-limit-'));
  const server = await start(dir);
  t.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 10; i++) assert.equal((await server.request('/api/auth/login', post({ identifier: 'missing', password: 'wrong' }))).status, 401);
  assert.equal((await server.request('/api/auth/login', post({ identifier: 'missing', password: 'wrong' }))).status, 429);
});

test('production uses Secure cookies behind an HTTPS proxy', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm1-production-'));
  const server = await start(dir, { NODE_ENV: 'production' });
  t.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const options = post({ identifier: 'produser', password: 'StrongPass123!' });
  options.headers['X-Forwarded-Proto'] = 'https';
  const response = await server.request('/api/auth/register', options);
  assert.equal(response.status, 201);
  assert.match(response.headers.get('set-cookie'), /; Secure/);
});

test('production refuses a missing or short session secret', async () => {
  for (const value of ['', 'too-short']) {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'production', SESSION_SECRET: value },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const [code] = await once(child, 'exit');
    assert.notEqual(code, 0);
    assert.match(stderr, /SESSION_SECRET must be set/);
  }
});
