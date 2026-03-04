// api/admin.js
// Admin endpoints — only you have access
// POST /api/admin/approve-request  — approve trial worker job request
// POST /api/admin/promote-worker   — promote trial → vetted
// GET  /api/admin/dashboard        — overview stats
// POST /api/admin/cancel-booking   — manual cancel + refund

const supabase = require('../lib/supabase');
const { assignJobToWorker } = require('../lib/jobber');
const { notifyCustomer, notifyAdmin } = require('../lib/notify');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Simple admin auth — checks against env var secret
function isAdmin(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  return token === process.env.ADMIN_SECRET;
}

module.exports = async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { action } = req.query;

  try {

    // Approve a trial worker's job request
    if (req.method === 'POST' && action === 'approve-request') {
      const { requestId } = req.body;

      const { data: request } = await supabase
        .from('job_requests')
        .select('*, workers(*)')
        .eq('id', requestId)
        .single();

      if (!request) return res.status(404).json({ error: 'Request not found' });

      // Assign in Jobber
      await assignJobToWorker({
        jobId: request.jobber_job_id,
        workerId: request.workers.jobber_worker_id,
      });

      // Update request status
      await supabase
        .from('job_requests')
        .update({ status: 'approved' })
        .eq('id', requestId);

      // Update booking
      const { data: booking } = await supabase
        .from('bookings')
        .update({ status: 'assigned', assigned_worker_id: request.worker_id })
        .eq('jobber_job_id', request.jobber_job_id)
        .select('*, customers(*)')
        .single();

      // Notify worker
      if (request.workers) {
        // Workers check app for updates — could add SMS here later
      }

      // Notify customer
      if (booking?.customers) {
        const customer = booking.customers;
        await notifyCustomer({
          preference: customer.contact_preference,
          email: customer.email,
          phone: customer.phone,
          subject: 'Your HomeDasher cleaner is confirmed! ✨',
          message: `Hi ${customer.name.split(' ')[0]}! Your cleaner has been confirmed for ${request.job_date}. See you then!`,
          html: `<p>Hi ${customer.name.split(' ')[0]}! Your HomeDasher cleaner is confirmed for ${request.job_date}. See you then!</p>`,
        });
      }

      return res.status(200).json({ success: true });
    }

    // Promote trial worker to vetted
    if (req.method === 'POST' && action === 'promote-worker') {
      const { workerId } = req.body;
      await supabase
        .from('workers')
        .update({ tier: 'vetted' })
        .eq('id', workerId);

      return res.status(200).json({ success: true });
    }

    // Dashboard stats
    if (req.method === 'GET' && action === 'dashboard') {
      const [bookings, customers, workers, requests, ratings] = await Promise.all([
        supabase.from('bookings').select('status, amount_cents, date').order('date', { ascending: false }).limit(50),
        supabase.from('customers').select('id, booking_count').order('booking_count', { ascending: false }),
        supabase.from('workers').select('id, name, tier, is_active'),
        supabase.from('job_requests').select('*').eq('status', 'pending'),
        supabase.from('ratings').select('stars'),
      ]);

      const totalRevenue = (bookings.data || []).reduce((sum, b) => sum + (b.amount_cents || 0), 0);
      const avgRating = ratings.data?.length
        ? (ratings.data.reduce((s, r) => s + r.stars, 0) / ratings.data.length).toFixed(1)
        : null;

      return res.status(200).json({
        totalBookings: bookings.data?.length || 0,
        totalRevenueCents: totalRevenue,
        totalCustomers: customers.data?.length || 0,
        returningCustomers: (customers.data || []).filter(c => c.booking_count > 1).length,
        activeWorkers: (workers.data || []).filter(w => w.is_active).length,
        pendingJobRequests: requests.data?.length || 0,
        averageRating: avgRating,
        recentBookings: bookings.data?.slice(0, 10) || [],
      });
    }

    // Manual cancel and refund
    if (req.method === 'POST' && action === 'cancel-booking') {
      const { bookingId, reason } = req.body;

      const { data: booking } = await supabase
        .from('bookings')
        .select('*, customers(*)')
        .eq('id', bookingId)
        .single();

      if (!booking) return res.status(404).json({ error: 'Booking not found' });

      // Refund via Stripe
      const refund = await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent_id,
      });

      // Update booking status
      await supabase
        .from('bookings')
        .update({ status: 'cancelled', refund_id: refund.id })
        .eq('id', bookingId);

      // Notify customer
      const customer = booking.customers;
      await notifyCustomer({
        preference: customer.contact_preference,
        email: customer.email,
        phone: customer.phone,
        subject: 'Your HomeDasher booking has been cancelled',
        message: `Hi ${customer.name.split(' ')[0]}, your booking for ${booking.date} has been cancelled and a full refund of $${(booking.amount_cents / 100).toFixed(2)} has been issued. It may take 5-10 business days to appear.${reason ? ` Reason: ${reason}` : ''}`,
        html: `<p>Hi ${customer.name.split(' ')[0]}, your booking has been cancelled and a full refund of <strong>$${(booking.amount_cents / 100).toFixed(2)}</strong> has been issued. It may take 5-10 business days to appear on your statement.</p>`,
      });

      return res.status(200).json({ success: true, refundId: refund.id });
    }

    return res.status(404).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: 'Admin action failed.' });
  }
};
