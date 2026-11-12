const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');

function installGoogleAuth(app, { db, limiter, config = process.env, client }) {
  const enabled = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REDIRECT_URI);
  const oauth = client || (enabled ? new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_REDIRECT_URI) : null);
  db.exec(`CREATE TABLE IF NOT EXISTS google_accounts (
    subject TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id)
  )`);
  const account = db.prepare('SELECT users.id, users.identifier FROM google_accounts JOIN users ON users.id = google_accounts.user_id WHERE subject = ?');
  const saveAccount = db.transaction(subject => {
    const existing = account.get(subject);
    if (existing) return existing;
    // Never auto-link an email to a password account. Google identity is its sub.
    const identifier = 'google:' + crypto.randomUUID();
    const result = db.prepare('INSERT INTO users (identifier, password_hash) VALUES (?, ?)').run(identifier, '!google-only');
    db.prepare('INSERT INTO google_accounts (subject, user_id) VALUES (?, ?)').run(subject, result.lastInsertRowid);
    return { id: Number(result.lastInsertRowid), identifier };
  });
  const unavailable = (req, res, next) => enabled ? next() : res.status(503).send('Google sign-in is not configured yet. Please use username/password.');
  app.get('/api/auth/google', limiter, unavailable, (req, res, next) => {
    const state = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    req.session.googleLogin = { state, nonce, created: Date.now() };
    req.session.save(error => {
      if (error) return next(error);
      res.redirect(oauth.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce, prompt: 'select_account' }));
    });
  });
  app.get('/api/auth/google/callback', limiter, unavailable, async (req, res, next) => {
    const pending = req.session.googleLogin;
    delete req.session.googleLogin;
    // Consume state before any asynchronous token exchange, including failures.
    try {
      await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      if (!pending || typeof req.query.state !== 'string' || req.query.state !== pending.state || Date.now() - pending.created > 600000) {
        return res.status(400).send('Google sign-in expired or invalid. Start again.');
      }
      if (req.query.error) return res.status(400).send('Google sign-in was cancelled. Return to the site and try again.');
      if (typeof req.query.code !== 'string' || !req.query.code) return res.status(400).send('Missing Google authorization code.');
      const { tokens } = await oauth.getToken(req.query.code);
      if (!tokens.id_token) throw new Error('Missing identity token');
      const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_CLIENT_ID });
      const identity = ticket.getPayload();
      if (!identity || !identity.sub || identity.nonce !== pending.nonce || identity.email_verified !== true) throw new Error('Invalid Google identity');
      const user = saveAccount(identity.sub);
      await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      req.session.user = { ...user, identifier: identity.email || user.identifier };
      await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      res.redirect('/dashboard');
    } catch (error) {
      // Do not log authorization codes or tokens from OAuth library errors.
      res.status(502).send('Google sign-in failed. Return to the site and try again.');
    }
  });
}
module.exports = { installGoogleAuth };
