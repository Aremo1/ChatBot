/**
 * Mail helper used for password-reset OTPs (and anything else that
 * needs to reach a user's inbox).
 *
 * Configuration (all optional):
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM
 *
 * When SMTP is not configured the message is logged to the server
 * console instead, and callers may expose the OTP to the client in
 * non-production so the reset flow stays testable locally.
 */

const nodemailer = require('nodemailer');

let transporter = null;
let transportTried = false;

function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

function getTransporter() {
  if (transportTried) return transporter;
  transportTried = true;
  if (!isSmtpConfigured()) return null;
  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  } catch (err) {
    console.error('Mailer setup failed:', err.message);
    transporter = null;
  }
  return transporter;
}

/**
 * Send an email. Returns { sent, mocked } so callers know whether the
 * message actually left the box or was only logged.
 */
async function sendMail({ to, subject, text, html }) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost';
  const transport = getTransporter();

  if (!transport) {
    console.log('--- EMAIL (SMTP not configured, logged only) ---');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text || '');
    console.log('------------------------------------------------');
    return { sent: false, mocked: true };
  }

  await transport.sendMail({ from, to, subject, text, html });
  return { sent: true, mocked: false };
}

/** True when the OTP may be echoed back to the API caller (local dev/tests). */
function canExposeOtp() {
  return !isSmtpConfigured() && process.env.NODE_ENV !== 'production';
}

module.exports = { sendMail, canExposeOtp, isSmtpConfigured };
