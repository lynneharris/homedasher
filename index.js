// index.js
// Main Vercel serverless entry point
// Routes all /api/* requests to the correct handler

const express = require('express');
const app = express();

// Raw body needed for Stripe webhook signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// JSON body for all other routes
app.use(express.json());

// CORS — allow requests from your frontend
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Routes
app.all('/api/chat', require('./api/chat'));
app.all('/api/submit', require('./api/submit'));
app.all('/api/magic-link', require('./api/magic-link'));
app.all('/api/verify', require('./api/verify'));
app.all('/api/rating', require('./api/rating'));
app.all('/api/webhook', require('./api/webhook'));
app.all('/api/worker', require('./api/worker'));
app.all('/api/admin', require('./api/admin'));
app.all('/api/cron', require('./api/cron'));
app.all('/api/referral/generate', (req, res) => require('./api/referral').generate(req, res));
app.all('/api/referral/redeem', (req, res) => require('./api/referral').redeem(req, res));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'HomeDasher', version: '1.0.0' }));

module.exports = app;
