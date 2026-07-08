// GET /api/survey-results?key=ADMIN_KEY&survey=covid-intake
// Returns: { ok, rows: [ { id, status, answers, contact_email, contact_phone, created_at } ] }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, code, obj){ res.status(code).setHeader("Content-Type","application/json"); res.end(JSON.stringify(obj)); }

module.exports = async function handler(req, res){
  if (req.method !== "GET") return json(res, 405, { ok:false, error:"method_not_allowed" });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { ok:false, error:"server_not_configured" });

  const key = req.query && req.query.key ? String(req.query.key) : "";
  if (!process.env.SURVEY_ADMIN_KEY || key !== process.env.SURVEY_ADMIN_KEY)
    return json(res, 401, { ok:false, error:"unauthorized" });

  const survey = req.query && req.query.survey ? String(req.query.survey).slice(0, 80) : "";
  let q = "survey_responses?select=id,status,answers,contact_email,contact_phone,created_at&order=created_at.desc";
  if (survey) q += "&survey_id=eq." + encodeURIComponent(survey);

  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/" + q,
      { headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY } });
    const rows = await r.json();
    return json(res, 200, { ok:true, rows: Array.isArray(rows) ? rows : [] });
  } catch (e) {
    return json(res, 500, { ok:false, error:"unexpected" });
  }
};
