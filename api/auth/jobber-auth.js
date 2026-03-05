// /api/auth/jobber.js
// Starts the Jobber OAuth authorization flow
// Visit https://homedasher.net/api/auth/jobber to begin

export default function handler(req, res) {
  const params = new URLSearchParams({
    client_id: process.env.JOBBER_CLIENT_ID,
    redirect_uri: process.env.JOBBER_REDIRECT_URI,
    response_type: 'code',
  });

  const authUrl = `https://api.getjobber.com/api/oauth/authorize?${params}`;
  return res.redirect(authUrl);
}
