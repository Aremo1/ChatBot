/**
 * Attachment uploads — JSON data-URL in, public URL out.
 *
 * Files are stored under backend/uploads/attachments and served by the
 * static /uploads mount in app.js. Kept as JSON (rather than multipart)
 * so no extra dependency is needed; the body limit is 10 MB.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'chatbot-dev-secret-change-in-production';

const ATTACHMENTS_DIR = path.join(__dirname, '../../uploads/attachments');
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB binary (~4 MB base64)

const ALLOWED = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

function verifyToken(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

router.post('/', async (req, res) => {
  try {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ success: false, message: 'Invalid token' });

    const { file, name } = req.body || {};
    const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(file || ''));
    if (!match) {
      return res.status(400).json({ success: false, message: 'Send a base64 data URL in `file`' });
    }
    const mime = match[1].toLowerCase();
    if (!ALLOWED[mime]) {
      return res.status(400).json({
        success: false,
        message: 'File type not allowed. Allowed: images, PDF, TXT, CSV, ZIP, DOCX, XLSX',
      });
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0) {
      return res.status(400).json({ success: false, message: 'Empty file' });
    }
    if (buffer.length > MAX_BYTES) {
      return res.status(400).json({ success: false, message: 'File is larger than 3 MB' });
    }

    const ext = ALLOWED[mime];
    const filename = `${decoded.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(ATTACHMENTS_DIR, filename), buffer);

    const safeName = String(name || 'attachment').replace(/[/\\]/g, '_').slice(0, 200);
    res.json({
      success: true,
      attachment: {
        url: `/uploads/attachments/${filename}`,
        name: safeName,
        mime,
        size: buffer.length,
      },
    });
  } catch (err) {
    console.error('Attachment upload error:', err.message);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
});

module.exports = router;
