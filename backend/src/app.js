/**
 * Express + Socket.IO application setup
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { setupSocketHandlers } = require('./socket/socketHandler');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static assets (uploaded profile pictures).
app.use('/uploads', express.static(require('path').join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', require('./routes/authRoute'));
app.use('/api/chats', require('./routes/chatRoute'));
app.use('/api/messages', require('./routes/messageRoute'));
app.use('/api/users', require('./routes/userRoute'));
app.use('/api/local', require('./routes/localRoute'));
app.use('/api/gmail', require('./routes/gmailRoute'));
app.use('/api/requests', require('./routes/requestRoute'));
app.use('/api/notifications', require('./routes/notificationRoute'));
app.use('/api/admin', require('./routes/adminRoute'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Rhosam ChatBot Backend',
  });
});

// 404 for unknown API routes (instead of a bare HTML error page).
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Create HTTP server and Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Socket.IO handlers
setupSocketHandlers(io);

module.exports = { app, server, io };
