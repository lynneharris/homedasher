// api/verify.js
// Validates magic link token and returns customer's saved chore list

const supabase = require('../lib/supabase');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token required' });

    // Look up token
    const { data: magicToken } = await supabase
      .from('magic_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (!magicToken) return res.status(401).json({ error: 'Invalid or expired link' });
    if (new Date(magicToken.expires_at) < new Date()) {
      return res.status(401).json({ error: 'This link has expired. Request a new one.' });
    }

    // Get customer + chore list
    const { data: customer } = await supabase
      .from('customers')
      .select('name, email, phone, address, contact_preference, booking_count, referral_code')
      .eq('email', magicToken.customer_email)
      .single();

    const { data: choreList } = await supabase
      .from('chore_lists')
      .select('content')
      .eq('customer_email', magicToken.customer_email)
      .single();

    // Delete used token
    await supabase.from('magic_tokens').delete().eq('token', token);

    return res.status(200).json({
      customer,
      choreList: choreList?.content || null,
    });

  } catch (err) {
    console.error('Verify error:', err);
    return res.status(500).json({ error: 'Verification failed.' });
  }
};
