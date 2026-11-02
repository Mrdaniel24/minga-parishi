// Minga Parish — bulk SMS through the parish's SMS provider (Vercel serverless function).
//
//   GET  /api/sms                   → { configured, provider, sender }
//   POST /api/sms {message_id}      → sends a message prepared in "Matangazo na SMS"
//
// The sender signs in as usual: this function calls the database WITH THE
// SENDER'S OWN SIGN-IN, so the database decides whether they may send
// (permission comms.send) and hands over the fixed list of numbers once
// (sms_claim), then records the result (sms_finish). No service key is used.
//
// Settings (Vercel → Project → Settings → Environment Variables):
//   SMS_PROVIDER     beem | nextsms
//   SMS_SENDER_ID    the approved Sender ID, e.g. PAROKIA
//   Beem Africa:     BEEM_API_KEY, BEEM_SECRET_KEY
//   NextSMS:         NEXTSMS_USERNAME, NEXTSMS_PASSWORD
//   (optional)       SUPABASE_URL, SUPABASE_ANON_KEY — default: the values in assets/js/config.js
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gyntomzlvmwiywtsdoth.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5bnRvbXpsdm13aXl3dHNkb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMTAwMDEsImV4cCI6MjEwNzY4NjAwMX0.8FYHk8TCEMVK8rlLYUfc2eupffc46s9eP69zvbUkAwY';

const provider = () => {
  const p = String(process.env.SMS_PROVIDER || '').toLowerCase();
  const sender = process.env.SMS_SENDER_ID || '';
  if (p === 'beem' && process.env.BEEM_API_KEY && process.env.BEEM_SECRET_KEY && sender) return { name: 'beem', label: 'Beem Africa', sender };
  if (p === 'nextsms' && process.env.NEXTSMS_USERNAME && process.env.NEXTSMS_PASSWORD && sender) return { name: 'nextsms', label: 'NextSMS', sender };
  return null;
};
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

async function sendChunk(prov, text, phones) {
  if (prov.name === 'beem') {
    const res = await fetch('https://apisms.beem.africa/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: basic(process.env.BEEM_API_KEY, process.env.BEEM_SECRET_KEY) },
      body: JSON.stringify({ source_addr: prov.sender, schedule_time: '', encoding: 0, message: text,
        recipients: phones.map((dest_addr, i) => ({ recipient_id: i + 1, dest_addr })) }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.successful !== false, status: res.status, body };
  }
  const res = await fetch('https://messaging-service.co.tz/api/sms/v1/text/single', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: basic(process.env.NEXTSMS_USERNAME, process.env.NEXTSMS_PASSWORD) },
    body: JSON.stringify({ from: prov.sender, to: phones, text }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function rpc(token, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((body && (body.message || body.msg)) || `database ${res.status}`), { status: res.status === 401 ? 401 : 400 });
  return body;
}

module.exports = async (req, res) => {
  const send = (status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  const prov = provider();
  if (req.method === 'GET') return send(200, { configured: !!prov, provider: prov && prov.label, sender: prov && prov.sender });
  if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
  if (!prov) return send(503, { error: 'Mtoa huduma wa SMS hajawekwa kwenye server.' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return send(401, { error: 'Ingia kwanza.' });

  let body = req.body;
  if (!body || typeof body === 'string') { try { body = JSON.parse(body || await new Promise(r => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => r(d)); })); } catch { body = {}; } }
  const id = body && body.message_id;
  if (!id) return send(400, { error: 'message_id inahitajika' });

  let msg;
  try { msg = await rpc(token, 'sms_claim', { p_id: id }); }
  catch (e) { return send(e.status || 400, { error: e.message }); }

  const results = [];
  let ok = true;
  try {
    for (let i = 0; i < msg.phones.length; i += 500) {
      const r = await sendChunk(prov, msg.body, msg.phones.slice(i, i + 500));
      results.push(r);
      if (!r.ok) { ok = false; break; }
    }
  } catch (e) {
    ok = false;
    results.push({ ok: false, error: String(e.message || e) });
  }
  try { await rpc(token, 'sms_finish', { p_id: id, p_ok: ok, p_provider: prov.name, p_result: { chunks: results } }); }
  catch (e) { /* the send already happened; the status stays "sending" and can be checked with the provider */ }
  if (!ok) return send(502, { error: `Mtoa huduma amekataa: ${JSON.stringify(results[results.length - 1].body || results[results.length - 1].error || '').slice(0, 300)}` });
  return send(200, { sent: msg.phones.length, provider: prov.label });
};
