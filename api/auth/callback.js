// /api/auth/callback.js
// Jobber OAuth callback handler
//
// Flow:
//   1. User visits /api/auth/jobber to start authorization
//   2. Jobber redirects here with ?code=xxxx after user approves
//   3. This route exchanges the code for an access token + refresh token
//   4. Tokens are printed to Vercel logs so you can save them as env variables
//
// Environment variables needed:
//   JOBBER_CLIENT_ID      — from Jobber developer portal
//   JOBBER_CLIENT_SECRET  — from Jobber developer portal
//   JOBBER_REDIRECT_URI   — https://homedasher.net/api/auth/callback

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    console.error('Jobber OAuth error:', error);
    return res.status(400).send(`Authorization failed: ${error}`);
  }

  if (!code) {
    return res.status(400).send('No authorization code received.');
  }

  try {
    // Exchange the code for tokens
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

    // Log tokens so you can copy them into Vercel env variables
    console.log('=== JOBBER TOKENS — COPY THESE INTO VERCEL ===');
    console.log('JOBBER_ACCESS_TOKEN:', tokens.access_token);
    console.log('JOBBER_REFRESH_TOKEN:', tokens.refresh_token);
    console.log('Expires in:', tokens.expires_in, 'seconds');
    console.log('==============================================');

    // Show success page
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
