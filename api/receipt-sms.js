// Send one valid payment receipt to one phone number through the configured provider.
const { provider, sendChunk } = require('./_sms-provider');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gyntomzlvmwiywtsdoth.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5bnRvbXpsdm13aXl3dHNkb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMTAwMDEsImV4cCI6MjEwNzY4NjAwMX0.8FYHk8TCEMVK8rlLYUfc2eupffc46s9eP69zvbUkAwY';

async function rpc(token, fn, args) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error((body && (body.message || body.msg)) || `database ${response.status}`), { status: response.status === 401 ? 401 : 400 });
  return body;
}

module.exports = async (req, res) => {
  const send = (status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  if (req.method === 'GET') {
    const p = provider();
    return send(200, { configured: !!p, provider: p && p.label });
  }
  if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
  const prov = provider();
  if (!prov) return send(503, { error: 'Mtoa huduma wa SMS hajawekwa kwenye server.' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return send(401, { error: 'Ingia kwanza.' });
  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || await new Promise(resolve => { let data = ''; req.on('data', chunk => { data += chunk; }); req.on('end', () => resolve(data)); })); }
    catch { body = {}; }
  }
  const receiptId = body && body.receipt_id;
  const phone = body && body.phone;
  const requestKey = body && body.request_key;
  if (!receiptId || !requestKey) return send(400, { error: 'receipt_id na request_key zinahitajika.' });
  let job;
  try { job = await rpc(token, 'receipt_sms_claim', { p_receipt_id: receiptId, p_phone: phone || null, p_request_key: requestKey }); }
  catch (error) { return send(error.status || 400, { error: error.message }); }

  let results = [];
  let ok = false;
  try {
    const result = await sendChunk(prov, job.body, job.phones);
    results = [result];
    ok = result.ok;
  } catch (error) {
    results = [{ ok: false, error: String(error.message || error) }];
  }
  try { await rpc(token, 'receipt_sms_finish', { p_id: job.id, p_ok: ok, p_provider: prov.name, p_result: { chunks: results } }); }
  catch (error) {
    if (ok) return send(502, { error: 'SMS imetumwa, lakini mfumo haukuweza kusasisha hali yake. Hakikisha kwenye ripoti ya SMS kabla ya kuituma tena.' });
  }
  if (!ok) return send(502, { error: `Mtoa huduma amekataa kutuma SMS: ${String(results[0]?.error || results[0]?.body?.message || 'Jaribu tena').slice(0, 250)}` });
  return send(200, { sent: true, provider: prov.label });
};
