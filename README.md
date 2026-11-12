# MM1 — Interactive Lamp Login

A full-stack authentication demo built with Node.js, Express, SQLite, server-side sessions, and bcrypt password hashing.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set a unique session secret (at least 32 characters). Do not commit `.env`.

3. Start the server:

   ```bash
   npm start
   ```

4. Open http://localhost:3000

## Validation

Run `npm run check` for JavaScript syntax checks and `npm test` for HTTP integration tests.
The tests start isolated server processes with temporary SQLite databases and verify
registration, duplicate accounts, invalid passwords, protected pages, logout, persisted
accounts and sessions after restart, rate limiting, private-file protection, UTF-8
password limits, and production cookie/secret settings. Test accounts are discarded.
GitHub Actions runs both checks using the committed dependency lockfile (`npm ci`).
These local tests do not replace testing the final HTTPS deployment and persistent disk.

## Features

- Account registration with unique username/email identifier
- Password hashing using bcrypt (12 rounds); plaintext passwords are never stored
- Login verification against SQLite
- Server-side sessions stored in SQLite
- HTTP-only, SameSite=Lax cookies; Secure cookies in production
- Login/register rate limiting
- Protected dashboard and logout endpoint

## API

- `POST /api/auth/register` — JSON: `{ "identifier": "...", "password": "..." }`
- `POST /api/auth/login` — JSON: `{ "identifier": "...", "password": "..." }`
- `GET /api/auth/me` — current session
- `POST /api/auth/logout` — destroy current session

## Deployment notes

This is a Node.js application. GitHub Pages only hosts static files and cannot run the Express server or SQLite database. Deploy the app to a Node.js host with persistent disk storage, set `NODE_ENV=production`, set a strong `SESSION_SECRET`, and configure `DATA_DIR` to a persistent writable directory. Use HTTPS in production.

The Google, GitHub, and Apple buttons from the original mockup are intentionally not presented as working sign-in methods; OAuth providers require separate provider credentials and callback configuration.
