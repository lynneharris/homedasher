// POST /api/survey-save
// Body: { survey, answers, status: 'draft'|'complete', token?, contact?: {email|phone} }
// - No token  -> insert a new row (server generates the token)
// - With token -> update the existing row
// - status 'draft' + contact -> best-effort send a resume link (email via Resend, SMS via Twilio)
// Returns: { ok: true, token }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, code, obj){ res.status(code).setHeader("Content-Type","application/json"); res.end(JSON.stringify(obj)); }

async function sb(path, opts){
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json",
      ...(opts && opts.headers ? opts.headers : {})
    }
  });
  const text = await r.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch(e){ body = text; }
  return { ok: r.ok, status: r.status, body };
}

function newToken(){
  // URL-safe random token
  const c = require("crypto");
  return c.randomBytes(18).toString("base64").replace(/[+/=]/g, "").slice(0, 24);
}

async function sendEmail(to, link){
  if (!process.env.RESEND_API_KEY) return;
  const from = process.env.RESEND_FROM || "HomeDasher <hello@homedasher.net>";
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to,
      subject: "Finish your HomeDasher care preferences",
      html:
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#1F2A2E">' +
        '<p>Hi there,</p>' +
        '<p>Here’s your private link to pick up your HomeDasher care preferences right where you left off:</p>' +
        '<p><a href="' + link + '" style="background:#3A707F;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;display:inline-block">Continue my survey</a></p>' +
        '<p style="color:#6B7B80;font-size:13px">Or paste this into your browser:<br>' + link + '</p>' +
        '<p style="color:#6B7B80;font-size:13px">— HomeDasher</p></div>'
    })
  }).catch(function(){});
}

async function sendSms(to, link){
  const sid = process.env.TWILIO_ACCOUNT_SID, auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const msgSvc = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !auth || (!from && !msgSvc)) return;
  const body = new URLSearchParams();
  body.set("To", to);
  if (msgSvc) body.set("MessagingServiceSid", msgSvc); else body.set("From", from);
  body.set("Body", "Your HomeDasher care preferences — finish where you left off: " + link);
  await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(sid + ":" + auth).toString("base64"),
               "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  }).catch(function(){});
}

module.exports = async function handler(req, res){
  if (req.method !== "POST") return json(res, 405, { ok:false, error:"method_not_allowed" });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { ok:false, error:"server_not_configured" });

  let data = req.body;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch(e){ data = {}; } }
  data = data || {};

  const survey = (data.survey || "").toString().slice(0, 80);
  const status = data.status === "complete" ? "complete" : "draft";
  const answers = (data.answers && typeof data.answers === "object") ? data.answers : {};
  const contact = data.contact || {};
  const email = contact.email ? String(contact.email).slice(0, 200) : null;
  const phone = contact.phone ? String(contact.phone).slice(0, 40)  : null;

  if (!survey) return json(res, 400, { ok:false, error:"missing_survey" });

  let token = data.token ? String(data.token).slice(0, 64) : null;

  try {
    if (token) {
      const patch = { answers, status, updated_at: new Date().toISOString() };
      if (email) patch.contact_email = email;
      if (phone) patch.contact_phone = phone;
      const r = await sb("survey_responses?token=eq." + encodeURIComponent(token),
        { method:"PATCH", headers:{ Prefer:"return=representation" }, body: JSON.stringify(patch) });
      if (!r.ok || !Array.isArray(r.body) || r.body.length === 0)
        return json(res, 404, { ok:false, error:"draft_not_found" });
    } else {
      token = newToken();
      const row = { survey_id: survey, token, status, answers, contact_email: email, contact_phone: phone };
      const r = await sb("survey_responses",
        { method:"POST", headers:{ Prefer:"return=representation" }, body: JSON.stringify(row) });
      if (!r.ok) return json(res, 500, { ok:false, error:"insert_failed" });
    }

    // Best-effort resume link — a failure here never loses the saved response.
    if (status === "draft" && (email || phone)) {
      const base = (process.env.SITE_URL || "").replace(/\/$/, "");
      const link = base + "/survey.html?token=" + encodeURIComponent(token);
      if (email) await sendEmail(email, link);
      if (phone) await sendSms(phone, link);
    }

    return json(res, 200, { ok:true, token });
  } catch (e) {
    return json(res, 500, { ok:false, error:"unexpected" });
  }
};
