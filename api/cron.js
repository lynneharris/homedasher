// api/cron.js
// Background cron job — runs every 15 minutes via Vercel Cron
// Checks for unassigned jobs and escalates or auto-cancels as needed

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../lib/supabase');
const { getUnassignedJobs } = require('../lib/jobber');
const { notifyCustomer, notifyAdmin } = require('../lib/notify');

const ALERT_HOURS = parseFloat(process.env.UNCLAIMED_ALERT_HOURS) || 2;
const AUTOCANCEL_HOURS = parseFloat(process.env.UNCLAIMED_AUTOCANCEL_HOURS) || 4;

module.exports = async (req, res) => {
  // Vercel Cron authenticates with a secret header
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const results = { alerted: 0, cancelled: 0, errors: 0 };

    // Get all unassigned bookings from Supabase
    const { data: unassignedBookings } = await supabase
      .from('bookings')
      .select('*, customers(name, email, phone, contact_preference)')
      .eq('status', 'unassigned');

    for (const booking of unassignedBookings || []) {
      const createdAt = new Date(booking.created_at);
      const hoursUnassigned = (now - createdAt) / (1000 * 60 * 60);
      const jobDate = new Date(`${booking.date}T${booking.time}`);
      const hoursUntilJob = (jobDate - now) / (1000 * 60 * 60);

      // Auto-cancel if job date is within 4 hours and still unassigned
      // OR if it's been unassigned for AUTOCANCEL_HOURS
      const shouldAutoCancel =
        hoursUntilJob < AUTOCANCEL_HOURS ||
        hoursUnassigned > AUTOCANCEL_HOURS;

      if (shouldAutoCancel && !booking.cancel_notified) {
        try {
          // Issue full Stripe refund
          await stripe.refunds.create({
            payment_intent: booking.stripe_payment_intent_id,
            reason: 'duplicate', // closest Stripe reason — use 'fraudulent' only for fraud
          });

          // Update booking status
          await supabase.from('bookings').update({
            status: 'cancelled',
            cancel_reason: 'unassigned',
            cancel_notified: true,
            cancelled_at: new Date().toISOString(),
          }).eq('id', booking.id);

          // Notify customer
          const customer = booking.customers;
          const firstName = customer.name.split(' ')[0];
          const formattedDate = new Date(`${booking.date}T${booking.time}`).toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric'
          });

          await notifyCustomer({
            preference: customer.contact_preference,
            email: customer.email,
            phone: customer.phone,
            subject: 'Your HomeDasher booking has been cancelled',
            message: `Hi ${firstName}, we're sorry — we weren't able to assign a cleaner for your appointment on ${formattedDate}. Your full payment has been refunded and should appear in 5-7 business days. We're sorry for the inconvenience.`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px;">
                <h2 style="color: #0e7490;">We're sorry, ${firstName}</h2>
                <p style="color: #334155;">We weren't able to assign a cleaner for your appointment on <strong>${formattedDate}</strong>.</p>
                <p style="color: #334155;">Your full payment has been refunded and should appear in <strong>5-7 business days</strong>.</p>
                <p style="color: #475569;">We sincerely apologize for the inconvenience. We hope to serve you better next time.</p>
                <a href="${process.env.APP_URL}" style="display: inline-block; background: linear-gradient(135deg, #0891b2, #0e7490); color: white; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: bold; font-size: 16px; margin: 16px 0;">Rebook When Ready →</a>
                <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">HomeDasher · homedasher.net</p>
              </div>
            `,
          });

          await notifyAdmin(`⚠️ Auto-cancelled booking #${booking.id} for ${customer.name} on ${formattedDate} — full refund issued.`);
          results.cancelled++;

        } catch (err) {
          console.error(`Auto-cancel failed for booking ${booking.id}:`, err);
          results.errors++;
        }

      // Alert admin if job has been unassigned for ALERT_HOURS but not yet at cancel threshold
      } else if (hoursUnassigned >= ALERT_HOURS && !booking.alert_sent) {
        try {
          const formattedDate = new Date(`${booking.date}T${booking.time}`).toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric'
          });

          await notifyAdmin(
            `⚠️ Job still unassigned after ${ALERT_HOURS}hrs! Booking #${booking.id} for ${booking.customers.name} on ${formattedDate}. Will auto-cancel in ${(AUTOCANCEL_HOURS - hoursUnassigned).toFixed(1)}hrs if not assigned.`
          );

          await supabase.from('bookings').update({ alert_sent: true }).eq('id', booking.id);
          results.alerted++;

        } catch (err) {
          console.error(`Alert failed for booking ${booking.id}:`, err);
          results.errors++;
        }
      }
    }

    console.log('Cron results:', results);
    return res.status(200).json({ success: true, ...results });

  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ error: 'Cron job failed.' });
  }
};
