// GET /api/survey-load?token=XXXX
// Returns: { survey_id, status, answers }  — only the fields the form needs.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, code, obj){ res.status(code).setHeader("Content-Type","application/json"); res.end(JSON.stringify(obj)); }

module.exports = async function handler(req, res){
  if (req.method !== "GET") return json(res, 405, { error:"method_not_allowed" });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error:"server_not_configured" });

  const token = (req.query && req.query.token) ? String(req.query.token).slice(0, 64) : "";
  if (!token) return json(res, 400, { error:"missing_token" });

  try {
    const r = await fetch(
      SUPABASE_URL + "/rest/v1/survey_responses?token=eq." + encodeURIComponent(token) +
      "&select=survey_id,status,answers&limit=1",
      { headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY } }
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return json(res, 404, { error:"not_found" });
    return json(res, 200, rows[0]);
  } catch (e) {
    return json(res, 500, { error:"unexpected" });
  }
};
