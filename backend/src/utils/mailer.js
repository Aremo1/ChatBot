/**
 * Mail helper used for password-reset OTPs (and anything else that
 * needs to reach a user's inbox).
 *
 * Configuration (all optional, set in backend/.env):
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM
 *
 * When SMTP is not configured the message is logged to the server
 * console instead, and callers may expose the OTP to the client in
 * non-production so the reset flow stays testable locally.
 *
 * Verify your setup with:  npm run check-email -- you@example.com
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
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });
  } catch (err) {
    console.error('Mailer setup failed:', err.message);
    transporter = null;
  }
  return transporter;
}

/**
 * Check the SMTP connection once at boot so a typo in .env is loud
 * and immediate instead of surfacing the first time someone resets
 * their password.
 */
async function verifyMail() {
  if (!isSmtpConfigured()) {
    console.log('📧 SMTP not configured (SMTP_HOST empty) — emails are logged to the console only.');
    return false;
  }
  try {
    await getTransporter().verify();
    console.log(`📧 SMTP ready: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`);
    return true;
  } catch (err) {
    console.error(`📧 SMTP verification FAILED for ${process.env.SMTP_HOST}:`, err.message);
    return false;
  }
}

function fromAddress() {
  return process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost';
}

/**
 * Send an email with one automatic retry. Returns { sent, mocked } so
 * callers know whether the message actually left the box or was only
 * logged.
 */
async function sendMail({ to, subject, text, html }) {
  const transport = getTransporter();

  if (!transport) {
    console.log('--- EMAIL (SMTP not configured, logged only) ---');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text || '');
    console.log('------------------------------------------------');
    return { sent: false, mocked: true };
  }

  const payload = { from: fromAddress(), to, subject, text, html };
  try {
    await transport.sendMail(payload);
  } catch (err) {
    console.error(`Email to ${to} failed (${err.message}), retrying once…`);
    await new Promise((r) => setTimeout(r, 1000));
    await transport.sendMail(payload);
  }
  return { sent: true, mocked: false };
}

/** Wrap simple content in a clean HTML mail shell. */
function htmlShell(title, lines) {
  const body = lines
    .map((l) => `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.5">${l}</p>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
      <h2 style="margin:0 0 16px;color:#0f172a;font-size:18px">${title}</h2>
      ${body}
    </div>
  </body></html>`;
}

/** True when the OTP may be echoed back to the API caller (local dev/tests). */
function canExposeOtp() {
  return !isSmtpConfigured() && process.env.NODE_ENV !== 'production';
}

module.exports = { sendMail, verifyMail, canExposeOtp, isSmtpConfigured, htmlShell };
