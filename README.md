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
  gitignored and stays local):
  ```
  PORT=4000
  FRONTEND_URL=https://chatbot-saxe.onrender.com
  JWT_SECRET=<a long random secret>
  DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD   (or leave SQLite mode
                                                         as-is for a single
                                                         free-tier instance)
  ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME               (so the admin account
                                                           is bootstrapped on boot)
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_SECURE=false
  SMTP_USER=<your Gmail address>
  SMTP_PASS=<your Gmail app password>
  EMAIL_FROM=<your Gmail address>
  GOOGLE_CLIENT_ID=<your Google OAuth client ID>
  GOOGLE_CLIENT_SECRET=<your Google OAuth client secret>
  GOOGLE_REDIRECT_URI=https://chatbot-saxe.onrender.com/api/auth/google/callback
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

### Google OAuth callback

Once the service is live, add the production callback URI to your Google Cloud
Console OAuth client:

```
https://chatbot-saxe.onrender.com/api/auth/google/callback
```

Keep your localhost callback (`http://localhost:4000/api/auth/google/callback`)
while developing. Then set `GOOGLE_REDIRECT_URI` in the Render env to the same
production URI so the backend sends the right redirect to Google during the
OAuth flow. The backend route that consumes it is
`/api/auth/google/callback` (`backend/src/routes/authRoute.js`), so the path
must be exactly that.

### Mobile install

Open `https://chatbot-saxe.onrender.com` on a phone or desktop. The **Install
app** button (or the browser's *Add to Home Screen*) installs the PWA; the
manifest and service worker are already in `frontend/public/`, so no extra
build step is needed beyond the env variables above.

## Google Gmail Integration

The app uses the Google Gmail API with OAuth 2.0:
1. User clicks "Connect Gmail"
2. Redirects to Google OAuth consent screen
3. User authorizes the app
4. Backend receives the authorization code
5. Backend exchanges code for access + refresh tokens
6. Tokens stored in database for future use
7. App can read inbox and send emails

## License

MIT
