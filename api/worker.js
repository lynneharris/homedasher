// api/worker.js
// Worker portal endpoints
// GET  /api/worker/jobs         — list available (unassigned) jobs
// POST /api/worker/claim        — vetted worker claims a job instantly
// POST /api/worker/request      — trial worker requests a job (needs admin approval)
// GET  /api/worker/my-jobs      — worker's currently assigned jobs

const supabase = require('../lib/supabase');
const { assignJobToWorker, getUnassignedJobs } = require('../lib/jobber');
const { notifyCustomer, notifyAdmin } = require('../lib/notify');

// Middleware: verify worker token from Supabase
async function getWorker(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data } = await supabase
    .from('workers')
    .select('*')
    .eq('auth_token', token)
    .single();
  return data;
}

module.exports = async (req, res) => {
  const { action } = req.query;

  try {
    const worker = await getWorker(req);
    if (!worker || !worker.is_active) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // GET available jobs
    if (req.method === 'GET' && action === 'jobs') {
      const jobs = await getUnassignedJobs();
      return res.status(200).json({ jobs });
    }

    // POST claim job (vetted workers only)
    if (req.method === 'POST' && action === 'claim') {
      if (worker.tier !== 'vetted') {
        return res.status(403).json({ error: 'Only vetted workers can claim jobs directly.' });
      }

      const { jobId, jobberJobId } = req.body;

      // Assign in Jobber
      await assignJobToWorker({ jobId: jobberJobId, workerId: worker.jobber_worker_id });

      // Update booking status in Supabase
      const { data: booking } = await supabase
        .from('bookings')
        .update({ status: 'assigned', assigned_worker_id: worker.id })
        .eq('jobber_job_id', jobberJobId)
        .select('*, customers(*)')
        .single();

      // Notify customer their cleaner is confirmed
      if (booking?.customers) {
        const customer = booking.customers;
        const formattedDate = new Date(`${booking.date}T${booking.time}`).toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric'
        });
        await notifyCustomer({
          preference: customer.contact_preference,
          email: customer.email,
          phone: customer.phone,
          subject: 'Your HomeDasher cleaner is confirmed! ✨',
          message: `Hi ${customer.name.split(' ')[0]}! Your cleaner has been assigned for ${formattedDate}. See you then!`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #0891b2, #0e7490); padding: 28px 32px; border-radius: 12px 12px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 24px;">Your cleaner is confirmed! ✨</h1>
              </div>
              <div style="background: #f8fafc; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
                <p style="color: #334155; font-size: 16px;">Hi ${customer.name.split(' ')[0]}! Your HomeDasher cleaner has been assigned for <strong>${formattedDate}</strong>.</p>
                <p style="color: #475569; font-size: 14px;">We'll see you then! Cancel anytime before your appointment for a full refund.</p>
                <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">HomeDasher · homedasher.net</p>
              </div>
            </div>
          `,
        });
      }

      return res.status(200).json({ success: true });
    }

    // POST request job (trial workers)
    if (req.method === 'POST' && action === 'request') {
      const { jobberJobId, jobDate, jobTime, address } = req.body;

      // Save request to Supabase for admin review
      await supabase.from('job_requests').insert({
        worker_id: worker.id,
        worker_name: worker.name,
        jobber_job_id: jobberJobId,
        job_date: jobDate,
        job_time: jobTime,
        address,
        status: 'pending',
        created_at: new Date().toISOString(),
      });

      // Alert admin
      await notifyAdmin(
        `Job request from trial worker ${worker.name} for ${jobDate} at ${jobTime} — ${address}. Approve in admin panel.`
      );

      return res.status(200).json({ success: true, message: 'Request sent. Admin will review shortly.' });
    }

    // GET worker's own jobs
    if (req.method === 'GET' && action === 'my-jobs') {
      const { data: bookings } = await supabase
        .from('bookings')
        .select('*, customers(name, address, phone)')
        .eq('assigned_worker_id', worker.id)
        .in('status', ['assigned', 'in_progress'])
        .order('date', { ascending: true });

      return res.status(200).json({ jobs: bookings || [] });
    }

    return res.status(404).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Worker error:', err);
    return res.status(500).json({ error: 'Worker action failed.' });
  }
};
