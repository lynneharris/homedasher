// /api/notify.js
// Saves "Notify Me" email signups to Supabase `waitlist` table

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const { error } = await supabase
    .from('waitlist')
    .insert({ email: email.toLowerCase().trim() });

  if (error) {
    // Duplicate email — treat as success (no need to alarm the user)
    if (error.code === '23505') {
      return res.status(200).json({ ok: true, message: "You're already on the list!" });
    }
    console.error('Supabase error:', error);
    return res.status(500).json({ error: 'Could not save your email. Please try again.' });
  }

  return res.status(200).json({ ok: true, message: "You're on the list! We'll let you know when we launch." });
}
