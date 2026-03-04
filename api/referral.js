// api/referral.js
// Handles referral code generation and credit application
// GET /api/referral?email= → returns customer's referral code + stats
// POST /api/referral/apply → applies a referral code for a new customer

const { v4: uuidv4 } = require('uuid');
const supabase = require('../lib/supabase');
const { notifyCustomer } = require('../lib/notify');

const REFERRAL_CREDIT_CENTS = parseInt(process.env.REFERRAL_CREDIT_CENTS) || 1500; // $15 default

module.exports = async (req, res) => {
  // GET — return referral code and stats for a customer
  if (req.method === 'GET') {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email required' });

    const { data: customer } = await supabase
      .from('customers')
      .select('referral_code, referral_credit_cents, name')
      .eq('email', email)
      .single();

    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // Count successful referrals
    const { count } = await supabase
      .from('referrals')
      .select('*', { count: 'exact' })
      .eq('referrer_email', email)
      .eq('status', 'credited');

    return res.status(200).json({
      referralCode: customer.referral_code,
      referralUrl: `${process.env.APP_URL}?ref=${customer.referral_code}`,
      creditBalance: customer.referral_credit_cents,
      successfulReferrals: count || 0,
    });
  }

  // POST — apply a referral code when new customer books
  if (req.method === 'POST') {
    try {
      const { newCustomerEmail, referralCode } = req.body;
      if (!newCustomerEmail || !referralCode) {
        return res.status(400).json({ error: 'newCustomerEmail and referralCode required' });
      }

      // Find the referrer
      const { data: referrer } = await supabase
        .from('customers')
        .select('*')
        .eq('referral_code', referralCode)
        .single();

      if (!referrer) return res.status(404).json({ error: 'Invalid referral code' });

      // Prevent self-referral
      if (referrer.email === newCustomerEmail) {
        return res.status(400).json({ error: 'Cannot refer yourself' });
      }

      // Check new customer hasn't already booked (referral only valid for first booking)
      const { data: newCustomer } = await supabase
        .from('customers')
        .select('booking_count')
        .eq('email', newCustomerEmail)
        .single();

      if (newCustomer && newCustomer.booking_count > 0) {
        return res.status(400).json({ error: 'Referral only valid for first booking' });
      }

      // Check not already referred by same code
      const { data: existingReferral } = await supabase
        .from('referrals')
        .select('id')
        .eq('referee_email', newCustomerEmail)
        .single();

      if (existingReferral) {
        return res.status(400).json({ error: 'Already applied a referral code' });
      }

      // Save referral as pending (credited after new customer completes first booking)
      await supabase.from('referrals').insert({
        referrer_email: referrer.email,
        referee_email: newCustomerEmail,
        referral_code: referralCode,
        status: 'pending',
        credit_cents: REFERRAL_CREDIT_CENTS,
        created_at: new Date().toISOString(),
      });

      // Give new customer immediate credit
      await supabase
        .from('customers')
        .upsert({
          email: newCustomerEmail,
          referral_credit_cents: REFERRAL_CREDIT_CENTS,
          referred_by: referralCode,
        }, { onConflict: 'email' });

      return res.status(200).json({
        success: true,
        creditApplied: REFERRAL_CREDIT_CENTS,
        message: `$${(REFERRAL_CREDIT_CENTS / 100).toFixed(0)} credit applied to your first booking!`,
      });

    } catch (err) {
      console.error('Referral apply error:', err);
      return res.status(500).json({ error: 'Failed to apply referral code.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

// Called after a referred customer completes their first booking
// Credits the referrer
async function creditReferrer(newCustomerEmail) {
  const { data: referral } = await supabase
    .from('referrals')
    .select('*')
    .eq('referee_email', newCustomerEmail)
    .eq('status', 'pending')
    .single();

  if (!referral) return;

  // Credit referrer
  const { data: referrer } = await supabase
    .from('customers')
    .select('referral_credit_cents, contact_preference, email, phone, name')
    .eq('email', referral.referrer_email)
    .single();

  if (referrer) {
    await supabase
      .from('customers')
      .update({
        referral_credit_cents: (referrer.referral_credit_cents || 0) + REFERRAL_CREDIT_CENTS,
      })
      .eq('email', referral.referrer_email);

    // Mark referral as credited
    await supabase
      .from('referrals')
      .update({ status: 'credited', credited_at: new Date().toISOString() })
      .eq('id', referral.id);

    // Notify referrer
    const credit = `$${(REFERRAL_CREDIT_CENTS / 100).toFixed(0)}`;
    await notifyCustomer({
      preference: referrer.contact_preference,
      email: referrer.email,
      phone: referrer.phone,
      subject: `You earned a ${credit} referral credit! 🎉`,
      message: `Great news ${referrer.name.split(' ')[0]}! Someone you referred just completed their first HomeDasher clean. You've earned a ${credit} credit toward your next booking!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #0891b2, #0e7490); padding: 28px 32px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">You earned ${credit}! 🎉</h1>
          </div>
          <div style="background: #f8fafc; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="color: #334155; font-size: 16px;">Hi ${referrer.name.split(' ')[0]}! Someone you referred just completed their first HomeDasher clean.</p>
            <p style="color: #334155;">Your <strong style="color: #0e7490;">${credit} credit</strong> has been added to your account and will automatically apply to your next booking.</p>
            <a href="${process.env.APP_URL}" style="display: inline-block; background: linear-gradient(135deg, #0891b2, #0e7490); color: white; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: bold; font-size: 16px; margin: 16px 0;">Book My Next Clean →</a>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">HomeDasher · homedasher.net</p>
          </div>
        </div>
      `,
    });
  }
}

module.exports.creditReferrer = creditReferrer;
