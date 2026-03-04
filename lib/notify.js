// lib/notify.js
// Unified notification sender - routes to email or SMS based on customer preference

const { Resend } = require('resend');
const twilio = require('twilio');

const resend = new Resend(process.env.RESEND_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Send to customer via their preferred channel
async function notifyCustomer({ preference, email, phone, subject, message, html }) {
  if (preference === 'sms' && phone) {
    return await sendSMS({ to: phone, message });
  } else {
    return await sendEmail({ to: email, subject, html: html || `<p>${message}</p>` });
  }
}

// Send email via Resend
async function sendEmail({ to, subject, html }) {
  return await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject,
    html,
  });
}

// Send SMS via Twilio
async function sendSMS({ to, message }) {
  return await twilioClient.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });
}

// Always notify admin via SMS (urgent operational alerts)
async function notifyAdmin(message) {
  return await twilioClient.messages.create({
    body: `[HomeDasher Alert] ${message}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.ADMIN_PHONE,
  });
}

// Also email admin for non-urgent notifications
async function emailAdmin({ subject, html }) {
  return await sendEmail({
    to: process.env.ADMIN_EMAIL,
    subject: `[HomeDasher] ${subject}`,
    html,
  });
}

module.exports = { notifyCustomer, sendEmail, sendSMS, notifyAdmin, emailAdmin };
