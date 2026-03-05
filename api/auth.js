// /api/auth.js
// Handles Jobber OAuth flow
//
// Routes:
//   GET /api/auth?action=jobber   — starts the authorization flow
//   GET /api/auth?action=callback — handles the callback from Jobber
//
// Environment variables needed:
//   JOBBER_CLIENT_ID
//   JOBBER_CLIENT_SECRET
//   JOBBER_REDIRECT_URI  — https://homedasher-app.vercel.app/api/auth?action=callback

export default async function handler(req, res) {
  const { action, code, error } = req.query;

  // ─────────────────────────────────────────────
  // START: Redirect to Jobber authorization page
  // Visit /api/auth?action=jobber to begin
  // ─────────────────────────────────────────────
  if (action === 'jobber') {
    const params = new URLSearchParams({
      client_id: process.env.JOBBER_CLIENT_ID,
      redirect_uri: process.env.JOBBER_REDIRECT_URI,
      response_type: 'code',
    });
    const authUrl = `https://api.getjobber.com/api/oauth/authorize?${params}`;
    return res.redirect(authUrl);
  }

  // ─────────────────────────────────────────────
  // CALLBACK: Exchange code for access token
  // Jobber redirects here after user authorizes
  // ─────────────────────────────────────────────
  if (action === 'callback') {
    if (error) {
      console.error('Jobber OAuth error:', error);
      return res.status(400).send(`Authorization failed: ${error}`);
    }

    if (!code) {
      return res.status(400).send('No authorization code received.');
    }

    try {
      const tokenRes = await fetch('https://api.getjobber.com/api/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: process.env.JOBBER_CLIENT_ID,
          client_secret: process.env.JOBBER_CLIENT_SECRET,
          redirect_uri: process.env.JOBBER_REDIRECT_URI,
          code,
        }),
      });

      const tokens = await tokenRes.json();

      if (!tokenRes.ok || tokens.error) {
        console.error('Token exchange failed:', tokens);
        return res.status(500).send(`Token exchange failed: ${tokens.error_description || tokens.error}`);
      }

      console.log('=== JOBBER TOKENS — COPY THESE INTO VERCEL ===');
      console.log('JOBBER_ACCESS_TOKEN:', tokens.access_token);
      console.log('JOBBER_REFRESH_TOKEN:', tokens.refresh_token);
      console.log('Expires in:', tokens.expires_in, 'seconds');
      console.log('==============================================');

      return res.status(200).send(`
        <html>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 60px auto; padding: 0 20px;">
            <h2 style="color: #3A707F;">✅ Jobber Connected!</h2>
            <p>Your HomeDasher app is now authorized to access your Jobber account.</p>
            <p>Check your <strong>Vercel logs</strong> to copy your access token and refresh token, then add them as environment variables:</p>
            <ul>
              <li><code>JOBBER_ACCESS_TOKEN</code></li>
              <li><code>JOBBER_REFRESH_TOKEN</code></li>
            </ul>
            <p style="color: #888; font-size: 13px;">This page is only used once during setup. You can ignore it after the tokens are saved.</p>
          </body>
        </html>
      `);

    } catch (err) {
      console.error('Callback error:', err);
      return res.status(500).send('Something went wrong during authorization.');
    }
  }

  // Fallback
  return res.status(400).send('Invalid action. Use ?action=jobber or ?action=callback');
}
