# Rhosam ChatBot

A real-time chat application built with **React + Vite** frontend and **Node.js + Express + Socket.IO** backend, with **Google OAuth** sign-in and **Gmail API** integration.

## Features

- **Email/password sign-up, sign-in and sign-out** with persisted sessions (JWT)
- **Password reset with a 6-digit OTP** sent to your email (dev mode shows the code in the UI when SMTP is not configured)
- **Admin accounts** — admins can add users, generate/reset passwords, promote/demote and disable accounts
- **People search & manual add** — search colleagues by name/email and send a contact request
- **Contact requests** — accept or decline requests; accepting opens a direct chat, both sides get real-time events
- **Notifications** — persisted inbox with unread badge (requests, accepts, new messages) and mark-as-read
- **Real-time messaging** via Socket.IO with read receipts, edit & delete, typing indicators
- **Smileys & stickers** — emoji picker plus big sticker messages
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
| GET | `/api/chats/:chatId` | Get chat with messages |
| POST | `/api/chats` | Create a chat |
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
