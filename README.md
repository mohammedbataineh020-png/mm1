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

Google sign-in is implemented but requires the configuration below. GitHub and Apple sign-in are not implemented.

## Deploy to Render

The repository includes `render.yaml` for one paid Node.js web service in Frankfurt
and a 1 GB persistent disk. Review Render's current price before creating it.

1. Open https://render.com/deploy?repo=https://github.com/mohammedbataineh020-png/mm1
   and connect the GitHub repository if prompted.
2. Review the Blueprint and create it. Render generates `SESSION_SECRET` automatically;
   keep it private and stable between deploys. SQLite accounts and sessions are stored
   under `/var/data/mm1`, inside the persistent disk. Do not delete the disk.
3. Use the HTTPS `onrender.com` URL shown by Render as the application's new address.
   The original GitHub Pages address serves only the frontend and cannot handle login.
4. Verify registration, sign-out, a wrong password, and sign-in on the new address.
   Restart the service, then confirm the account still works. Test repeated color taps
   on an actual iPhone. Successful CI does not verify the production host or iOS zoom.

The build runs the integration tests before starting the application. Later deploys
wait for GitHub checks to pass. Keep a single service instance with this local SQLite
setup. Set up SQLite-consistent off-host backups before storing important user data;
never commit database files or secrets to GitHub. Password recovery and providers other than Google
remain outside this version's scope. Its dashboard is a simple signed-in welcome page.

## Try the complete app from a phone (GitHub Codespaces)

Open https://codespaces.new/mohammedbataineh020-png/mm1?quickstart=1
in Safari or Chrome. Sign into GitHub if needed, choose the smallest (2-core)
machine, and create or resume the codespace. The configuration installs the
packages and starts MM1 automatically. Port 3000 is labeled **MM1 Website** and
requests opening the app in a browser. If your browser blocks that opening,
use the **Ports** panel and choose **Open in Browser** for port 3000. Keep the
port private; sign into GitHub in that browser to access the preview.

No terminal commands or source edits are required. You can register, sign in,
and sign out on the preview URL. Codespaces has a limited monthly free quota;
do not enable paid usage. Stop the codespace when finished. The URL only works
while it is running, and accounts remain only while that codespace's data exists.
Deleting the codespace also deletes its uncommitted SQLite data. This is a test
environment, not always-on public hosting. The initial image build and opening
from an actual iPhone still need to be verified in your account.

## Google sign-in setup

Google sign-in requires a Google Auth Platform OAuth client of type Web application,
an OAuth consent screen, and an exact authorized redirect URI:
`https://YOUR-LIVE-HOST/api/auth/google/callback`. Add test users if the Google app
is in testing mode. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
GOOGLE_REDIRECT_URI in the host environment, then redeploy. Never send or commit
the client secret. Locally the callback can be http://localhost:3000/api/auth/google/callback.
The Google button returns an explanatory 503 until configured. GitHub Pages
cannot run this route. Real Google account login remains unverified until the host
and credentials are configured. Google identities are stored separately by subject;
matching an email never automatically links an existing password account.
