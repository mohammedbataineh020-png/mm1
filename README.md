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
