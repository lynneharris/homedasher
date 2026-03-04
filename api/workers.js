// api/workers.js
// Worker portal endpoints
// GET /api/workers/jobs — list available (unassigned) jobs
// POST /api/workers/claim — vetted worker claims a job instantly
// POST /api/workers/request — trial worker requests a job (needs owner approval)
// POST /api/workers/approve — owner approves a trial worker's job request

const supabase = require('../lib/supabase');
const { assignJobToWorker, getUnassignedJobs } = require('../lib/jobber');
const { notifyCustomer, notifyAdmin, emailAdmin } = require('../lib/notify');

module.exports = async (req, res) => {
  const { action } = req.query;

  // GET available jobs
  if (req.method === 'GET' && action === 'jobs') {
    try {
      const jobs = await getUnassignedJobs();
      return res.status(200).json({ jobs });
    } catch (err) {
      console.error('Get jobs error:', err);
      return res.status(500).json({ error: 'Failed to load jobs.' });
    }
  }

  // POST — claim, request, or approve
  if (req.method === 'POST') {
    const { workerId, workerEmail, jobId, bookingId } = req.body;

    // Verify worker exists in Supabase
    const { data: worker } = await supabase
      .from('workers')
      .select('*')
      .eq('id', workerId)
      .single();

    if (!worker) return res.status(401).json({ error: 'Worker not found' });

    // VETTED: instant claim
    if (action === 'claim') {
      if (worker.tier !== 'vetted') {
        return res.status(403).json({ error: 'Only vetted workers can self-assign. Request this job instead.' });
      }

      try {
        // Assign in Jobber
        await assignJobToWorker({ jobId, workerId: worker.jobber_worker_id });

        // Update booking in Supabase
        await supabase.from('bookings').update({
          status: 'assigned',
          worker_id: workerId,
          assigned_at: new Date().toISOString(),
        }).eq('jobber_job_id', jobId);

        // Notify customer
        const { data: booking } = await supabase
          .from('bookings')
          .select('*, customers(name, email, phone, contact_preference)')
          .eq('jobber_job_id', jobId)
          .single();

        if (booking) {
          const customer = booking.customers;
          const firstName = customer.name.split(' ')[0];
          const formattedDate = new Date(`${booking.date}T${booking.time}`).toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric'
          });
          await notifyCustomer({
            preference: customer.contact_preference,
            email: customer.email,
            phone: customer.phone,
            subject: 'Your cleaner has been assigned! ✨',
            message: `Hi ${firstName}! Great news — ${worker.name} will be cleaning your home on ${formattedDate}. See you then!`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #0891b2, #0e7490); padding: 28px 32px; border-radius: 12px 12px 0 0;">
                  <h1 style="color: white; margin: 0; font-size: 24px;">Cleaner assigned! ✨</h1>
                </div>
                <div style="background: #f8fafc; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
                  <p style="color: #334155; font-size: 16px;">Hi ${firstName}! <strong>${worker.name}</strong> will be cleaning your home on ${formattedDate}.</p>
                  <p style="color: #475569;">If you need to make any changes, reply to this message or visit homedasher.net.</p>
                  <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">HomeDasher · homedasher.net</p>
                </div>
              </div>
            `,
          });
        }

        return res.status(200).json({ success: true, message: 'Job claimed successfully!' });

      } catch (err) {
        console.error('Claim error:', err);
        return res.status(500).json({ error: 'Failed to claim job.' });
      }
    }

    // TRIAL: request job — needs owner approval
    if (action === 'request') {
      try {
        // Save request in Supabase
        await supabase.from('job_requests').insert({
          worker_id: workerId,
          worker_name: worker.name,
          jobber_job_id: jobId,
          booking_id: bookingId,
          status: 'pending',
          created_at: new Date().toISOString(),
        });

        // Get job details for notification
        const { data: booking } = await supabase
          .from('bookings')
          .select('date, time, duration')
          .eq('jobber_job_id', jobId)
          .single();

        const formattedDate = booking
          ? new Date(`${booking.date}T${booking.time}`).toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric'
            })
          : 'TBD';

        await notifyAdmin(
          `Job request from trial worker ${worker.name} for ${formattedDate}. Approve at homedasher.net/admin`
        );

        return res.status(200).json({ success: true, message: 'Job request sent! Waiting for approval.' });

      } catch (err) {
        console.error('Request error:', err);
        return res.status(500).json({ error: 'Failed to send job request.' });
      }
    }

    // OWNER: approve a trial worker's request
    if (action === 'approve') {
      const { requestId } = req.body;

      // Simple admin auth check — in production use a proper session
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      try {
        const { data: request } = await supabase
          .from('job_requests')
          .select('*, workers(jobber_worker_id, name)')
          .eq('id', requestId)
          .single();

        if (!request) return res.status(404).json({ error: 'Request not found' });

        // Assign in Jobber
        await assignJobToWorker({
          jobId: request.jobber_job_id,
          workerId: request.workers.jobber_worker_id,
        });

        // Update request + booking status
        await supabase.from('job_requests').update({ status: 'approved' }).eq('id', requestId);
        await supabase.from('bookings').update({
          status: 'assigned',
          worker_id: request.worker_id,
          assigned_at: new Date().toISOString(),
        }).eq('jobber_job_id', request.jobber_job_id);

        return res.status(200).json({ success: true, message: `${request.workers.name} assigned to job.` });

      } catch (err) {
        console.error('Approve error:', err);
        return res.status(500).json({ error: 'Failed to approve request.' });
      }
    }
  }

  return res.status(405).json({ error: 'Invalid action' });
};
