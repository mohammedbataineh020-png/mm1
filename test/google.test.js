const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const { installGoogleAuth } = require('../google-auth');

async function fixture(t, enabled = true) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, identifier TEXT UNIQUE, password_hash TEXT NOT NULL)');
  const app = express();
  app.use(session({ secret: 'test-only-long-session-secret-123456789', resave: false, saveUninitialized: false }));
  let requested;
  let exchanged = 0;
  const config = enabled ? { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REDIRECT_URI: 'http://localhost/callback' } : {};
  const client = {
    generateAuthUrl(params) { requested = params; return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(params); },
    async getToken() { exchanged++; return { tokens: { id_token: 'mock-token' } }; },
    async verifyIdToken(args) {
      assert.equal(args.audience, 'test-client');
      return { getPayload: () => ({ sub: 'google-subject-123', nonce: requested.nonce, email_verified: true, email: 'test@example.com' }) };
    }
  };
  installGoogleAuth(app, { db, limiter: (req,res,next) => next(), config, client });
  app.get('/me', (req,res) => res.json(req.session.user || null));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); db.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (url, cookie) => fetch(base + url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  return { request, db, client, exchanged: () => exchanged, begin: async () => {
    const response = await request('/api/auth/google');
    assert.equal(response.status, 302);
    return { state: new URL(response.headers.get('location')).searchParams.get('state'), cookie: response.headers.get('set-cookie').split(';')[0] };
  } };
}

test('Google is explicitly unavailable until configured', async t => {
  const f = await fixture(t, false);
  assert.equal((await f.request('/api/auth/google')).status, 503);
});
test('Google login checks state before exchange and consumes attempts', async t => {
  const f = await fixture(t);
  const a = await f.begin();
  assert.equal((await f.request('/api/auth/google/callback?state=wrong&code=code', a.cookie)).status, 400);
  assert.equal((await f.request('/api/auth/google/callback?state='+a.state+'&code=code', a.cookie)).status, 400);
  assert.equal(f.exchanged(), 0);
});
test('Google success establishes session without linking matching password email', async t => {
  const f = await fixture(t);
  f.db.prepare('INSERT INTO users (identifier,password_hash) VALUES (?,?)').run('test@example.com','existing-password');
  const a = await f.begin();
  const response = await f.request('/api/auth/google/callback?state='+a.state+'&code=code', a.cookie);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/dashboard');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const user = await (await f.request('/me', cookie)).json();
  assert.equal(user.id, 2);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,2);
  const b = await f.begin();
  await f.request('/api/auth/google/callback?state='+b.state+'&code=code',b.cookie);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,2);
});
test('Google rejects nonce mismatch and cancelled consent', async t => {
  const f = await fixture(t);
  let a = await f.begin();
  assert.equal((await f.request('/api/auth/google/callback?state='+a.state+'&error=access_denied', a.cookie)).status, 400);
  a = await f.begin();
  f.client.verifyIdToken = async () => ({ getPayload: () => ({sub:'x',nonce:'bad',email_verified:true}) });
  assert.equal((await f.request('/api/auth/google/callback?state='+a.state+'&code=code',a.cookie)).status,502);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
});
