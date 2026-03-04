// api/rating.js
// Handles post-service rating submission
// Flow: job complete → worker marks done in Jobber → webhook fires → 
//       2hr delay → send rating request → customer submits here
// 4-5 stars: send tip prompt, then Google review link
// 1-3 stars: send private feedback channel, no Google review

const supabase = require('../lib/supabase');
const { notifyCustomer, notifyAdmin, emailAdmin } = require('../lib/notify');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const GOOGLE_REVIEW_LINK = process.env.GOOGLE_REVIEW_LINK || 'https://g.page/r/your-google-review-link';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { bookingId, stars, comment, tip } = req.body;
    if (!bookingId || !stars) return res.status(400).json({ error: 'bookingId and stars required' });
    if (stars < 1 || stars > 5) return res.status(400).json({ error: 'Stars must be 1-5' });

    // Load booking and customer
    const { data: booking } = await supabase
      .from('bookings')
      .select('*, customers(*)')
      .eq('id', bookingId)
      .single();

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const customer = booking.customers;

    // Save rating
    await supabase.from('ratings').insert({
      booking_id: bookingId,
      customer_email: customer.email,
      stars,
      comment: comment || null,
      created_at: new Date().toISOString(),
    });

    // Update booking status
    await supabase
      .from('bookings')
      .update({ rating: stars, status: 'rated' })
      .eq('id', bookingId);

    // Process tip if provided
    let tipProcessed = false;
    if (tip && tip > 0 && booking.stripe_payment_intent_id) {
      const tipCents = Math.round(tip * 100);
      await stripe.paymentIntents.create({
        amount: tipCents,
        currency: 'usd',
        customer: booking.stripe_customer_id,
        payment_method: booking.stripe_payment_method_id,
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: {
          type: 'tip',
          bookingId: bookingId.toString(),
          customerEmail: customer.email,
        },
        description: `Tip for HomeDasher booking #${bookingId}`,
      });

      await supabase
        .from('bookings')
        .update({ tip_cents: tipCents })
        .eq('id', bookingId);

      tipProcessed = true;
    }

    const firstName = customer.name.split(' ')[0];

    if (stars >= 4) {
      // Happy path — thank them and invite Google review
      await notifyCustomer({
        preference: customer.contact_preference,
        email: customer.email,
        phone: customer.phone,
        subject: 'Thanks for the great rating! ⭐',
        message: `${firstName}, thank you so much for your ${stars}-star rating${tip ? ` and your generous tip` : ''}! Would you mind leaving us a quick Google review? It helps us reach more people: ${GOOGLE_REVIEW_LINK}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #0891b2, #0e7490); padding: 28px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Thank you, ${firstName}! ⭐</h1>
            </div>
            <div style="background: #f8fafc; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
              <p style="color: #334155; font-size: 16px;">We're so glad you loved your clean! Your ${stars}-star rating means a lot to us${tip ? ` — and your tip made the team's day` : ''}.</p>
              <p style="color: #334155; font-size: 16px;">Would you mind sharing a quick Google review? It only takes a minute and helps us reach more homes in the area.</p>
              <a href="${GOOGLE_REVIEW_LINK}" style="display: inline-block; background: linear-gradient(135deg, #0891b2, #0e7490); color: white; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: bold; font-size: 16px; margin: 16px 0;">Leave a Google Review →</a>
              <p style="color: #64748b; font-size: 14px; margin-top: 20px;">Ready to book again? <a href="${process.env.APP_URL}" style="color: #0891b2;">Head back to HomeDasher</a> — your chore list is saved!</p>
              <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">HomeDasher · homedasher.net</p>
            </div>
          </div>
        `,
      });

    } else {
      // Low rating — capture private feedback, notify admin
      await notifyCustomer({
        preference: customer.contact_preference,
        email: customer.email,
        phone: customer.phone,
        subject: 'We want to make this right',
        message: `${firstName}, thank you for your honest feedback. We take this seriously and want to make it right. Our owner will reach out to you within 24 hours. If you'd like to speak sooner, reply to this message.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #0891b2, #0e7490); padding: 28px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">We want to make this right</h1>
            </div>
            <div style="background: #f8fafc; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
              <p style="color: #334155; font-size: 16px;">${firstName}, thank you for your honest feedback. We're sorry your experience didn't meet your expectations.</p>
              <p style="color: #334155; font-size: 16px;">Our owner will personally reach out to you within 24 hours. If you'd like to talk sooner, simply reply to this email.</p>
              <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">HomeDasher · homedasher.net</p>
            </div>
          </div>
        `,
      });

      // Alert admin immediately
      await notifyAdmin(
        `⚠️ Low rating: ${stars}/5 stars from ${customer.name} (${customer.email}). Comment: "${comment || 'none'}". Booking #${bookingId}.`
      );
    }

    // Rebooking prompt (sent 1 day after regardless of rating)
    // Scheduled via a separate cron — stored in bookings table with flag
    await supabase
      .from('bookings')
      .update({ rebook_prompt_pending: true })
      .eq('id', bookingId);

    return res.status(200).json({
      success: true,
      tipProcessed,
      googleReviewShown: stars >= 4,
    });

  } catch (err) {
    console.error('Rating error:', err);
    return res.status(500).json({ error: 'Failed to save rating.' });
  }
};
