// api/magic-link.js
// Sends a magic link to returning customers so they can
// log in without a password and load their saved chore list

const { v4: uuidv4 } = require('uuid');
const supabase = require('../lib/supabase');
const { notifyCustomer } = require('../lib/notify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, phone, preference } = req.body;
    if (!email && !phone) return res.status(400).json({ error: 'Email or phone required' });

    // Look up customer
    const query = email
      ? supabase.from('customers').select('*').eq('email', email)
      : supabase.from('customers').select('*').eq('phone', phone);

    const { data: customer } = await query.single();
    if (!customer) {
      // Don't reveal whether customer exists - just say sent
      return res.status(200).json({ sent: true });
    }

    // Generate token
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

    await supabase.from('magic_tokens').insert({
      token,
      customer_email: customer.email,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });

    const magicLink = `${process.env.APP_URL}/verify?token=${token}`;
    const contactPreference = preference || customer.contact_preference || 'email';

    await notifyCustomer({
      preference: contactPreference,
      email: customer.email,
      phone: customer.phone,
      subject: 'Your HomeDasher login link',
      message: `Hi ${customer.name.split(' ')[0]}! Click to load your cleaning plan: ${magicLink} (expires in 30 minutes)`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #0891b2, #0e7490); padding: 28px 32px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Your login link ✦</h1>
          </div>
          <div style="background: #f8fafc; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="color: #334155; font-size: 16px;">Hi ${customer.name.split(' ')[0]}! Click the button below to load your saved cleaning plan.</p>
            <a href="${magicLink}" style="display: inline-block; background: linear-gradient(135deg, #0891b2, #0e7490); color: white; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: bold; font-size: 16px; margin: 16px 0;">Load My Cleaning Plan →</a>
            <p style="color: #94a3b8; font-size: 13px;">This link expires in 30 minutes. If you didn't request this, ignore this message.</p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">HomeDasher · homedasher.net</p>
          </div>
        </div>
      `,
    });

    return res.status(200).json({ sent: true });

  } catch (err) {
    console.error('Magic link error:', err);
    return res.status(500).json({ error: 'Failed to send login link.' });
  }
};
