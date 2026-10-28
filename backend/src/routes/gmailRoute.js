/**
 * Gmail API routes with Google OAuth integration
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const { getClient } = require('../config/db-sqlite');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'chatbot-dev-secret-change-in-production';

async function getUserGmailTokens(userId) {
  const client = await getClient();
  try {
    const result = await client.query('SELECT token, refresh_token, expiry_date FROM gmail_tokens WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) return null;
    return result.rows[0].token || {};
  } finally {
    client.release();
  }
}

router.get('/inbox', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const userTokens = await getUserGmailTokens(decoded.id);
    if (!userTokens || !userTokens.access_token) {
      return res.status(401).json({ message: 'Gmail not connected. Please connect Gmail first.' });
    }
    const gmail = google.gmail({ version: 'v1', auth: userTokens });
    const response = await gmail.users.messages.list({ userId: 'me', maxResults: parseInt(req.query.max || '10'), labelIds: ['INBOX', 'UNREAD'] });
    const messages = response.data.messages || [];
    res.json({ success: true, messages });
  } catch (err) {
    console.error('Gmail inbox error:', err.message);
    res.status(500).json({ message: 'Failed to fetch Gmail inbox', error: err.message });
  }
});

router.get('/:messageId', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const userTokens = await getUserGmailTokens(decoded.id);
    if (!userTokens || !userTokens.access_token) {
      return res.status(401).json({ message: 'Gmail not connected. Please connect Gmail first.' });
    }
    const gmail = google.gmail({ version: 'v1', auth: userTokens });
    const response = await gmail.users.messages.get({ userId: 'me', id: req.params.messageId });
    res.json({ success: true, message: response.data });
  } catch (err) {
    console.error('Gmail get error:', err.message);
    res.status(500).json({ message: 'Failed to fetch Gmail message', error: err.message });
  }
});

router.post('/send', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const userTokens = await getUserGmailTokens(decoded.id);
    if (!userTokens || !userTokens.access_token) {
      return res.status(401).json({ message: 'Gmail not connected. Please connect Gmail first.' });
    }
    const { to, subject = 'Rhosam Chat', body } = req.body;
    if (!to || !body) {
      return res.status(400).json({ message: 'Missing to or body' });
    }
    const gmail = google.gmail({ version: 'v1', auth: userTokens });
    // Build a plain RFC 822 message, base64url-encoded as Gmail expects.
    const rawMessage = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      String(body),
    ].join('\r\n');
    const raw = Buffer.from(rawMessage, 'utf8').toString('base64url');
    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    res.json({ success: true, messageId: result.data.id });
  } catch (err) {
    console.error('Gmail send error:', err.message);
    res.status(500).json({ message: 'Failed to send email', error: err.message });
  }
});

module.exports = router;