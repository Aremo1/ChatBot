# Rhosam ChatBot

[![Tests](https://github.com/Aremo1/ChatBot/actions/workflows/test.yml/badge.svg)](https://github.com/Aremo1/ChatBot/actions/workflows/test.yml)

A real-time chat application built with **React + Vite** frontend and **Node.js + Express + Socket.IO** backend, with **Google OAuth** sign-in and **Gmail API** integration.

## Features

- **Email/password sign-up, sign-in and sign-out** with persisted sessions (JWT)
- **Password reset with a 6-digit OTP** sent to your email (dev mode shows the code in the UI when SMTP is not configured)
- **Admin accounts** — admins can add users, generate/reset passwords, promote/demote and disable accounts
- **People search & manual add** — search colleagues by name/email and send a contact request
- **Contact requests** — accept or decline requests; accepting opens a direct chat, both sides get real-time events
- **Notifications** — persisted inbox with unread badge (requests, accepts, new messages) and mark-as-read
- **Group chats** — create a named group, add people from search, members get notified in real time, anyone can leave
- **Message attachments** — images, PDF, TXT, CSV, ZIP, DOCX, XLSX up to 3 MB, rendered inline as images or download chips
- **Real-time messaging** via Socket.IO with read receipts, edit & delete, typing indicators
- **Smileys & stickers** — emoji picker plus big sticker messages
- **Mobile-friendly & installable (PWA)** — responsive layout and install-to-homescreen via web app manifest + service worker
- **Presence** with privacy controls — turn your online status off entirely, or limit who sees it (everyone / contacts / nobody) and whether you appear in people search
- **Profile picture upload** (PNG/JPEG/WebP/GIF up to 2 MB)
- **Gmail API integration** (read inbox, send emails, connect to Gmail)
- **SQLite storage out of the box** (no database server required)
- **Responsive UI** with Tailwind CSS

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, Tailwind CSS |
| Backend | Node.js, Express, Socket.IO |
| Database | PostgreSQL (via `pg`) |
| Auth | JSON Web Tokens (JWT) + Google OAuth |
| Email | Google Gmail API |

## Project Structure

```
ChatBot/
├── backend/
│   ├── src/
│   │   ├── config/          # Database config
│   │   ├── routes/          # Express routes
│   │   ├── utils/           # DB initialization
│   │   ├── index.js         # Entry point
│   │   └── app.js           # Express + Socket.IO setup
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main chat component
│   │   ├── main.jsx         # Entry point
│   │   └── index.css        # Tailwind + custom styles
│   ├── index.html
│   ├── package.json
│   └── .env.example
└── README.md
```

## Getting Started

### 1. Install Dependencies

**Backend:**
```bash
cd backend
npm install
```

**Frontend:**
```bash
cd frontend
npm install
```

### 2. Configure Environment Variables

**Backend:**
```bash
cp backend/.env.example backend/.env
# Edit backend/.env and add your Google OAuth credentials and database config
```

**Frontend:**
```bash
cp frontend/.env.example frontend/.env
# Edit frontend/.env (VITE_SOCKET_URL should point to your backend)
```

### 3. Set Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable **Gmail API** and **Google+ API**
4. Create OAuth 2.0 credentials (Web application)
5. Add your redirect URI to the OAuth client:

   ```
   http://localhost:4000/api/auth/google/callback
   ```

6. Copy the `Client ID` and `Client Secret` to your `.env` file

### 4. Set Up PostgreSQL

```bash
# Install PostgreSQL if not installed
# Create a database
createdb chatbot

# Run the schema initialization
cd backend
npm run setup-db
```

### 5. Start the Development Servers

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:5173` and the backend at `http://localhost:4000`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/local/signup` | Create an account |
| POST | `/api/local/signin` | Sign in |
| POST | `/api/local/signout` | Sign out |
| POST | `/api/local/forgot-password` | Send a 6-digit OTP to your email |
| POST | `/api/local/verify-otp` | Verify the OTP, get a reset token |
| POST | `/api/local/reset-password` | Set a new password with the reset token |
| POST | `/api/local/change-password` | Change password while signed in |
| GET | `/api/local/users?q=` | Search people (auth required) |
| POST | `/api/auth/google/register` | Google OAuth register |
| POST | `/api/auth/google/login` | Google OAuth login |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/requests` | List incoming/outgoing contact requests |
| POST | `/api/requests` | Send a contact request |
| POST | `/api/requests/:id/accept` | Accept a request (creates the chat) |
| POST | `/api/requests/:id/reject` | Reject a request |
| DELETE | `/api/requests/:id` | Cancel an outgoing request |
| GET | `/api/requests/connections` | List accepted connections |
| GET | `/api/notifications` | List notifications + unread count |
| POST | `/api/notifications/read` | Mark notifications as read |
| GET | `/api/chats` | Get all chats (with unread counts) |
| GET | `/api/chats/:chatId` | Get chat with messages (groups include members) |
| POST | `/api/chats` | Create a direct chat (`userId`+`otherUserId`) or a group (`name`+`memberIds`) |
| POST | `/api/chats/:chatId/members` | Add someone to a group |
| POST | `/api/chats/:chatId/leave` | Leave a group |
| POST | `/api/uploads` | Upload an attachment (data URL) → `/uploads/...` URL |
| POST | `/api/messages` | Send a message |
| GET | `/api/messages` | Get messages |
| PATCH | `/api/messages/:messageId/read` | Mark message as read |
| PATCH | `/api/messages/:messageId/edit` | Edit a message (sender only) |
| DELETE | `/api/messages/:messageId` | Delete a message |
| PATCH | `/api/users/:userId` | Update own profile / privacy settings |
| POST | `/api/users/me/avatar` | Upload a profile picture (data URL) |
| GET | `/api/gmail/inbox` | List recent emails |
| GET | `/api/gmail/:messageId` | Get specific email |
| POST | `/api/gmail/send` | Send email |
| GET | `/api/users` | Get users |
| GET | `/api/admin/users` | Admin: list accounts |
| POST | `/api/admin/users` | Admin: create a user |
| POST | `/api/admin/users/:id/reset-password` | Admin: reset a password |
| PATCH | `/api/admin/users/:id` | Admin: change role/active/name |

The admin account is bootstrapped from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
when the server starts (see `backend/.env.example`).

## Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `join_room` | Client → Server | Join a room |
| `user_joined` | Client → Server | Announce who signed in (opens presence) |
| `presence` | Server → Client | Roster of who *you* may see online |
| `user_joined` / `user_left` | Server → Client | Presence changes (filtered per viewer) |
| `send_message` | Client → Server | Send a message |
| `new_message` | Server → Client | New message received |
| `message_read` | Server → Client | Message marked as read |
| `message_edited` / `message_deleted` | Server → Client | Message edited/deleted |
| `typing` | Both | Typing indicator for the other participant |
| `notification` | Server → Client | New notification (request/message) |
| `new_request` | Server → Client | Incoming contact request |
| `request_accepted` / `request_rejected` / `request_cancelled` | Server → Client | Request outcome |
| `user_left` | Client → Server | Explicit sign-out presence |

## Tests

```bash
# Backend API + real-time suite (boots an isolated server + temp DB)
npm run test:api

# Browser end-to-end suite (drives Chrome through the real UI)
npm run test:e2e

# Both
npm test
```

GitHub Actions runs both suites on every push (`.github/workflows/test.yml`).

## Email (password-reset codes)

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM` in
`backend/.env`, then verify delivery with:

```bash
npm run check-email -- you@example.com
```

Without SMTP, emails are logged to the console and the OTP is shown in the
UI (dev mode only).

## Mobile

The UI is responsive (chat list and conversation swap on small screens)
and installable: open the app in the browser and use **Install app** (or
the browser's *Add to Home Screen*).

## Deployment

This app runs from a single origin — the same HTTPS host serves both the
backend API (and Socket.IO) and the built frontend, so the PWA can be
installed and the Socket.IO client reaches the backend without any
cross-origin setup.

Current production origin: `https://chatbot-saxe.onrender.com`.

### Backend + frontend (single Render web service)

- Connect the `Aremo1/ChatBot` repo to a Render **Web service**.
- **Root directory:** leave it at the repo root (not `backend/`) — the service
  now builds and serves both the frontend and the backend.
- **Build command:**
  ```bash
  cd frontend && npm install && npm run build && cd ../backend && npm install
  ```
  This builds the Vite frontend into `frontend/dist/` and installs the
  backend deps. The backend's `app.js` auto-serves `frontend/dist/` when it
  is present, so the same process serves the app at `/` and the API at
  `/api/*`.
- **Start command:** `cd backend && node src/index.js`
- **Plan:** Free (the service sleeps after inactivity; the first request after
  a cold start can take 30-60 seconds — expected for a free instance, not a
  bug).
- **Env variables** (set in the Render dashboard — `backend/.env` is
  gitignored and stays local). One consolidated block:
  ```
  # Server
  PORT=4000
  FRONTEND_URL=https://chatbot-saxe.onrender.com

  # JWT (change in production)
  JWT_SECRET=<a long random secret>

  # Database — fill these in if you use Postgres; leave them out to use the
  # bundled SQLite mode (fine for a single free-tier instance, but uploads and
  # the DB are ephemeral on free tiers and reset on restart).
  # DB_HOST=<postgres host>
  # DB_PORT=5432
  # DB_NAME=chatbot
  # DB_USER=<postgres user>
  # DB_PASSWORD=<postgres password>

  # Admin bootstrap — when set, this admin account is created or updated on
  # every server start (so someone can add users and reset passwords from the
  # Settings -> Admin panel).
  ADMIN_EMAIL=<admin email>
  ADMIN_PASSWORD=<admin password>
  ADMIN_NAME=Administrator

  # Email delivery (password-reset OTPs, admin-generated passwords).
  # Uses the Gmail app password you gave me earlier (host dashboard, not the
  # repo). Leave SMTP_HOST empty to log emails to the console instead — in dev
  # mode the reset code is also returned to the client.
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_SECURE=false
  SMTP_USER=<your Gmail address>
  SMTP_PASS=<your Gmail app password>
  EMAIL_FROM=<your Gmail address>

  # Google OAuth (token flow — see Google OAuth callback below)
  GOOGLE_CLIENT_ID=<your Google OAuth client ID>
  GOOGLE_CLIENT_SECRET=<your Google OAuth client secret>
  GOOGLE_REDIRECT_URI=https://chatbot-saxe.onrender.com
  ```
- The server calls `verifyMail()` at boot and logs a loud error if SMTP is
  misconfigured, so a bad mailbox blocks the deploy from going quiet-fail.

### Env variables baked into the frontend build

The frontend reads `VITE_API_URL` and `VITE_SOCKET_URL` at build time. For
this same-origin deploy both are the same origin as the backend, so set them
to:

```bash
VITE_API_URL=https://chatbot-saxe.onrender.com
VITE_SOCKET_URL=https://chatbot-saxe.onrender.com
```

If you build the frontend locally and copy `frontend/dist/` into the repo, set
those two variables in the environment **before** running `npm run build` in
`frontend/`. If Render builds the frontend as part of the service build command
above, add `VITE_API_URL` and `VITE_SOCKET_URL` as Render build-time env
variables (they're baked into the JS at build time, so the runtime `backend/`
`.env` does not reach them).

### Google OAuth callback (redirect URI)

This app uses the Google OAuth **token flow**, not a server-side callback
endpoint: the backend's `/gmail/start-session` route builds a Google consent
URL using `GOOGLE_REDIRECT_URI`, the user completes consent in the browser,
then the client sends the resulting `idToken` back to `/api/auth/google/register`
or `/api/auth/google/login`. (`backend/src/routes/authRoute.js`)

`GOOGLE_REDIRECT_URI` is passed straight into `google-auth-library`'s
`OAuth2Client` at boot, so it must be an **authorized redirect URI** in your
Google Cloud Console OAuth client.

Once the service is live, add the production redirect URI to your Google Cloud
Console OAuth client's **Authorized redirect URIs**:

```
https://chatbot-saxe.onrender.com
```

(You can also add the exact path the library sends — Google accepts the
registered origin; the library constructs the full redirect from
`GOOGLE_REDIRECT_URI`.)

Keep your localhost redirect URI authorized while developing:

```
http://localhost:4000
```

Then set these in the Render env (they're already listed in the consolidated
block above) so the backend builds the right consent URL:

```
GOOGLE_CLIENT_ID=<your Google OAuth client ID>
GOOGLE_CLIENT_SECRET=<your Google OAuth client secret>
GOOGLE_REDIRECT_URI=https://chatbot-saxe.onrender.com
```

If the authorized redirect URI in Google Cloud Console and
`GOOGLE_REDIRECT_URI` in Render don't match, Google rejects the consent
redirect with a "redirect_uri_mismatch" error.

### Mobile install

Open `https://chatbot-saxe.onrender.com` on a phone or desktop. The **Install
app** button (or the browser's *Add to Home Screen*) installs the PWA; the
manifest and service worker are already in `frontend/public/`, so no extra
build step is needed beyond the env variables above.

### Verifying the Google OAuth callback

This is the gate for the same-origin deploy: once the Render service is live,
serving the frontend from the same origin, and the GOOGLE_* env vars are set,
exercise the Connect Gmail flow end to end.

**What to do:**

1. Open `https://chatbot-saxe.onrender.com` in a browser and sign in (local
   sign-in or Google OAuth).
2. Open the dev tools Network tab.
3. In the app, start the Gmail connection (the **Connect Gmail** action calls
   `POST /api/auth/gmail/start-session`).
4. Confirm the response includes an `authUrl`.
5. Open that `authUrl` in a new tab and complete the Google consent screen.
6. After consent, the client should receive an `idToken` and POST it to
   `/api/auth/google/register` (first time) or `/api/auth/google/login`
   (returning user).
7. Confirm the app signs you in / links your Google account and the Gmail
   connection shows as active.

**Success looks like:** a consent screen that completes, an `idToken` POST
that returns 200, and the Gmail connection working in the app.

**Failure to watch for:** if the Authorized redirect URI you added to Google
Cloud Console doesn't match `GOOGLE_REDIRECT_URI` in Render, Google rejects
the consent redirect with a `redirect_uri_mismatch` error and the flow stops
at the consent step. In that case: confirm the OAuth client's
**Authorized redirect URIs** include `https://chatbot-saxe.onrender.com`,
confirm `GOOGLE_REDIRECT_URI` in Render is exactly
`https://chatbot-saxe.onrender.com`, and redeploy the Render service so it
picks up the updated value.

**Local parity:** keep `http://localhost:4000` in the OAuth client's
Authorized redirect URIs and use `GOOGLE_REDIRECT_URI=http://localhost:4000`
locally, so the same client works for both dev and production.

### Email delivery notes

Password-reset OTPs and admin-generated passwords are sent through SMTP using
the `SMTP_*` variables. The production config above points at Gmail
(`smtp.gmail.com:587` with a Gmail app password).

**If Gmail is unreachable from the Render host** (the connection can't complete
the SMTP handshake from that network), swap the `SMTP_*` variables to any
other SMTP provider — the backend does not depend on Gmail specifically. For
example:

- **Resend** — `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`,
  `SMTP_USER=resend-...@resend.dev`, `SMTP_PASS=<API key>`,
  `EMAIL_FROM=onboarding@resend.dev` (or your verified domain).
- **SendGrid** — `SMTP_HOST=smtp.sendgrid.net`, `SMTP_PORT=587`,
  `SMTP_USER=apikey`, `SMTP_PASS=<SendGrid API key>`,
  `EMAIL_FROM=<verified sender>`.
- **Mailgun** — `SMTP_HOST=smtp.mailgun.org`, `SMTP_PORT=587`,
  `SMTP_USER=postmaster@<sandbox or domain>`, `SMTP_PASS=<SMTP password>`,
  `EMAIL_FROM=<verified sender>`.

Whichever provider you use, verify delivery from the live service with:

```bash
npm run check-email -- you@example.com
```

The server also calls `verifyMail()` at boot and logs a loud error if SMTP is
misconfigured, so a bad mailbox blocks the deploy from going quiet-fail.

## Google Gmail Integration

The app uses the Google Gmail API with Google OAuth:
1. User clicks **Connect Gmail** in the app
2. The backend's `/api/auth/gmail/start-session` route builds a Google consent
   URL from `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
   `GOOGLE_REDIRECT_URI`, and returns it as `authUrl`
3. The user opens `authUrl` and completes the Google consent screen
4. Google returns an `idToken` to the client
5. The client sends the `idToken` to `/api/auth/google/register` (first time)
   or `/api/auth/google/login` (returning user)
6. The backend verifies the `idToken` with `google-auth-library` and creates
   or looks up the account, storing the OAuth tokens for Gmail API use
7. The app can read the inbox and send emails via the Gmail API

## License

MIT
