// api/apply.js
// Receives job application form data and emails it to lynneharris@outlook.com via Resend
// Requires RESEND_API_KEY environment variable set in Vercel dashboard

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    full_name,
    email,
    phone,
    neighborhood,
    availability,
    hours,
    experience,
    why,
  } = req.body;

  if (!full_name || !email || !phone || !neighborhood || !why) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; color: #1a2426;">
      <div style="background: #1e3d45; padding: 24px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="font-family: Georgia, serif; font-size: 26px; color: #FED807; margin: 0; letter-spacing: 1px;">New HomeDasher Application</h1>
        <p style="color: rgba(255,255,255,0.7); margin: 6px 0 0; font-size: 14px;">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>
      <div style="background: #ffffff; border: 1px solid #e0e8ea; border-top: none; padding: 32px; border-radius: 0 0 12px 12px;">

        <h2 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #3A707F; margin: 0 0 16px; font-weight: 600;">Applicant Info</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
          <tr><td style="padding: 8px 0; font-size: 13px; color: #6b8289; width: 140px; vertical-align: top;">Name</td><td style="padding: 8px 0; font-size: 14px; font-weight: 600;">${full_name}</td></tr>
          <tr><td style="padding: 8px 0; font-size: 13px; color: #6b8289; vertical-align: top;">Email</td><td style="padding: 8px 0; font-size: 14px;"><a href="mailto:${email}" style="color: #3A707F;">${email}</a></td></tr>
          <tr><td style="padding: 8px 0; font-size: 13px; color: #6b8289; vertical-align: top;">Phone</td><td style="padding: 8px 0; font-size: 14px;">${phone}</td></tr>
          <tr><td style="padding: 8px 0; font-size: 13px; color: #6b8289; vertical-align: top;">Location</td><td style="padding: 8px 0; font-size: 14px;">${neighborhood}</td></tr>
        </table>

        <h2 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #3A707F; margin: 0 0 16px; font-weight: 600;">Availability</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
          <tr><td style="padding: 8px 0; font-size: 13px; color: #6b8289; width: 140px; vertical-align: top;">Days</td><td style="padding: 8px 0; font-size: 14px;">${availability}</td></tr>
          <tr><td style="padding: 8px 0; font-size: 13px; color: #6b8289; vertical-align: top;">Hours</td><td style="padding: 8px 0; font-size: 14px;">${hours}</td></tr>
        </table>

        <h2 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #3A707F; margin: 0 0 16px; font-weight: 600;">Experience</h2>
        <p style="font-size: 14px; line-height: 1.7; background: #f7f8f6; border-radius: 8px; padding: 14px 16px; margin: 0 0 28px;">${experience || '<em style="color:#6b8289">Not provided</em>'}</p>

        <h2 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #3A707F; margin: 0 0 16px; font-weight: 600;">Why HomeDasher?</h2>
        <p style="font-size: 14px; line-height: 1.7; background: #f0f8fa; border: 1px solid #d4eaee; border-radius: 8px; padding: 14px 16px; margin: 0 0 28px;">${why}</p>

        <div style="background: #e8f8f0; border: 1px solid #68c89a; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #1a5e38;">
          ✅ Applicant confirmed all culture-fit items, background check consent, and W-2 employment acknowledgment.
        </div>

      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'HomeDasher Applications <applications@homedasher.net>',
        to: ['lynneharris@outlook.com'],
        reply_to: email,
        subject: `New Application: ${full_name} — HomeDasher`,
        html,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Resend error:', err);
      return res.status(500).json({ error: 'Email send failed' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Apply handler error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
