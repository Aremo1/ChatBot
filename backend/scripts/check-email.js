/**
 * Sends a test email through the configured SMTP server so you can
 * prove delivery before relying on password-reset codes.
 *
 *   npm run check-email -- you@example.com
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { sendMail, verifyMail, isSmtpConfigured } = require('../src/utils/mailer');

(async () => {
  if (!isSmtpConfigured()) {
    console.error('SMTP_HOST is not set. Fill in backend/.env first (see backend/.env.example).');
    process.exit(1);
  }

  const to = process.argv[2] || process.env.SMTP_TO;
  if (!to) {
    console.error('Usage: npm run check-email -- you@example.com');
    process.exit(1);
  }

  const ok = await verifyMail();
  if (!ok) {
    console.error('SMTP verification failed — check SMTP_HOST/PORT/USER/PASS.');
    process.exit(1);
  }

  const { sent } = await sendMail({
    to,
    subject: 'Rhosam ChatBot SMTP test',
    text: 'If you can read this, SMTP delivery from Rhosam ChatBot works and password-reset codes will arrive.',
  });

  if (sent) {
    console.log(`✅ Test email sent to ${to} — check that inbox (and spam).`);
    process.exit(0);
  }
  console.error('❌ Email was not sent.');
  process.exit(1);
})().catch((err) => {
  console.error('check-email failed:', err.message);
  process.exit(1);
});
