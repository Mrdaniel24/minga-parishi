// Minga Parish — bulk SMS through the parish's configured SMS provider.
const { provider, sendChunk } = require('./_sms-provider');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gyntomzlvmwiywtsdoth.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5bnRvbXpsdm13aXl3dHNkb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMTAwMDEsImV4cCI6MjEwNzY4NjAwMX0.8FYHk8TCEMVK8rlLYUfc2eupffc46s9eP69zvbUkAwY';

async function rpc(token, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, body: JSON.stringify(args),
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
  catch (e) { /* message was sent; status can be checked in the provider account */ }
  if (!ok) return send(502, { error: `Mtoa huduma amekataa: ${JSON.stringify(results[results.length - 1].body || results[results.length - 1].error || '').slice(0, 300)}` });
  return send(200, { sent: msg.phones.length, provider: prov.label });
};
