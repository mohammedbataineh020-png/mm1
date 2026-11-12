const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "app.sqlite");

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  if (NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters.");
  }
  console.warn("Using a development-only session secret. Set SESSION_SECRET before deployment.");
}

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const findUser = db.prepare("SELECT id, identifier, password_hash FROM users WHERE identifier = ?");
const createUser = db.prepare("INSERT INTO users (identifier, password_hash) VALUES (?, ?)");

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

if (NODE_ENV === "production") app.set("trust proxy", 1);

app.use(session({
  name: "mm1.sid",
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: DATA_DIR,
    table: "sessions",
    concurrentDB: true
  }),
  secret: process.env.SESSION_SECRET || "development-only-secret-change-before-deploy-12345",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in 15 minutes." }
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Please sign in to continue." });
  }
  next();
}

app.post("/api/auth/register", authLimiter, async (req, res, next) => {
  try {
    const identifier = String(req.body.identifier || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (identifier.length < 3 || identifier.length > 120) {
      return res.status(400).json({ error: "Username or email must be between 3 and 120 characters." });
    }
    if (/[\s]/.test(identifier)) {
      return res.status(400).json({ error: "Username or email cannot contain spaces." });
    }
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({ error: "Password must be at least 8 characters and at most 72 UTF-8 bytes." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let result;
    try {
      result = createUser.run(identifier, passwordHash);
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({ error: "This username or email is already registered." });
      }
      throw error;
    }

    req.session.user = { id: Number(result.lastInsertRowid), identifier };
    return req.session.save((error) => {
      if (error) return next(error);
      res.status(201).json({ user: req.session.user });
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  try {
    const identifier = String(req.body.identifier || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!identifier || !password) {
      return res.status(400).json({ error: "Enter your username or email and password." });
    }

    const user = findUser.get(identifier);
    const valid = user && await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Incorrect username/email or password." });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.user = { id: user.id, identifier: user.identifier };
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.json({ user: req.session.user });
      });
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/auth/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("mm1.sid", {
      httpOnly: true,
      secure: NODE_ENV === "production",
      sameSite: "lax"
    });
    res.status(204).end();
  });
});

app.get("/dashboard", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// Serve only the intended public assets. Never expose the repository root,
// archives, tests, or SQLite files, including a custom DATA_DIR.
for (const [url, filename] of Object.entries({
  "/": "index.html",
  "/index.html": "index.html",
  "/script.js": "script.js",
  "/styles.css": "styles.css"
})) {
  app.get(url, (req, res) => res.sendFile(path.join(__dirname, filename), {
    maxAge: NODE_ENV === "production" ? "1h" : 0,
    dotfiles: "deny"
  }));
}

app.use((req, res) => res.status(404).json({ error: "Page not found." }));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

app.listen(PORT, () => {
  console.log(`MM1 server running on port ${PORT}`);
});
