// Public self-registration for ordinary parish members. Secrets stay server-side.
const crypto = require('node:crypto');
const { provider } = require('./_sms-provider');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gyntomzlvmwiywtsdoth.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RELATIONSHIPS = new Set(['BABA','MAMA','MTOTO','MJUKUU','BIBI','BABU','KAKA','DADA','MJOMBA','SHANGAZI','MWINGINE']);

const normalizePhone = value => {
  let d = String(value || '').replace(/\D/g, '');
  if (/^0[67]\d{8}$/.test(d)) d = '255' + d.slice(1);
  else if (/^[67]\d{8}$/.test(d)) d = '255' + d;
  return /^\d{10,15}$/.test(d) ? d : null;
};
const hash = value => crypto.createHmac('sha256', SERVICE_KEY).update(String(value)).digest('hex');
const apiHeaders = () => ({ 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` });
const json = (res, status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };

async function serviceRpc(name, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(args) });
  const value = await r.json().catch(() => null);
  if (!r.ok) throw new Error((value && (value.message || value.details || value.hint)) || `database ${r.status}`);
  return value;
}
function getBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve(null); } }
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 50000) resolve(null); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); } });
  });
}
function clientIp(req) {
  const real = req.headers['x-real-ip'];
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return String(real || forwarded[forwarded.length - 1] || req.socket?.remoteAddress || 'unknown').slice(0, 100);
}

module.exports = async (req, res) => {
  const prov = provider();
  if (req.method === 'GET') return json(res, 200, { configured: !!prov && !!SERVICE_KEY, provider: prov && prov.label, sender: prov && prov.sender });
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  if (!SERVICE_KEY) return json(res, 503, { error: 'Usajili haujakamilika kwenye server. Msimamizi aweke SUPABASE_SERVICE_ROLE_KEY kwenye Vercel > Settings > Environment Variables (Production), kisha afanye Redeploy.' });
  const body = await getBody(req);
  if (!body || JSON.stringify(body).length > 45000) return json(res, 400, { error: 'Taarifa za usajili hazisomeki.' });
  if (body.consent !== true) return json(res, 400, { error: 'Thibitisha kuwa una ruhusa ya kuingiza taarifa za watu hawa.' });

  const kigangoId = String(body.kigango_id || '');
  const jumuiyaId = String(body.jumuiya_id || '');
  const familyId = body.family_id ? String(body.family_id) : null;
  const newFamilyName = String(body.new_family_name || '').trim().slice(0, 120);
  const headIndex = body.head_index == null ? null : Number(body.head_index);
  if (!/^[0-9a-f-]{36}$/i.test(kigangoId) || !/^[0-9a-f-]{36}$/i.test(jumuiyaId)) return json(res, 400, { error: 'Chagua kigango na jumuiya.' });
  if (familyId && !/^[0-9a-f-]{36}$/i.test(familyId)) return json(res, 400, { error: 'Chagua familia iliyopo.' });
  if (!familyId && (!newFamilyName || !Number.isInteger(headIndex))) return json(res, 400, { error: 'Andika jina la familia na chagua mkuu wake.' });
  if (!Array.isArray(body.members) || body.members.length < 1 || body.members.length > 12) return json(res, 400, { error: 'Usajili mmoja unaweza kuwa na waumini 1 hadi 12.' });

  const members = [];
  const phones = new Set();
  for (const [index, raw] of body.members.entries()) {
    const full_name = String(raw?.full_name || '').trim().slice(0, 120);
    const phone = String(raw?.phone || '').trim() ? normalizePhone(raw.phone) : null;
    const gender = ['male','female'].includes(raw?.gender) ? raw.gender : null;
    const relationship = String(raw?.relationship || '').trim().toUpperCase();
    const age = Number(raw?.age);
    const birth_year = new Date().getFullYear() - age;
    if (!full_name || (index === 0 && !phone) || (String(raw?.phone || '').trim() && !phone) || !RELATIONSHIPS.has(relationship) || !Number.isInteger(age) || age < 0 || age > 120) {
      return json(res, 400, { error: 'Kwa mtu wa kwanza jaza simu ya mawasiliano; kwa kila mwanafamilia jaza jina, umri na uhusiano sahihi.' });
    }
    if (phone && phones.has(phone)) return json(res, 400, { error: 'Namba za simu zilizowekwa lazima ziwe tofauti.' });
    if (phone) phones.add(phone);
    members.push({ full_name, phone, gender, age, birth_year, relationship });
  }
  if (!familyId && (headIndex < 0 || headIndex >= members.length)) return json(res, 400, { error: 'Chagua mkuu wa familia kwenye orodha.' });
  if (familyId && headIndex !== null) return json(res, 400, { error: 'Familia iliyopo tayari ina mkuu wake.' });

  const ipHash = hash(clientIp(req));
  try {
    const allowed = await serviceRpc('consume_registration_attempt', { p_phone_hash: hash(members[0].phone), p_ip_hash: ipHash });
    if (!allowed) return json(res, 429, { error: 'Usajili umefikia kikomo cha majaribio kwa sasa. Jaribu tena baada ya muda.' });
  } catch (e) {
    return json(res, 503, { error: 'Huduma ya usajili haipatikani kwa sasa.' });
  }

  let result;
  try {
    result = await serviceRpc('submit_public_family_request', { p: {
      kigango_id: kigangoId, jumuiya_id: jumuiyaId, family_id: familyId, contact_name: members[0].full_name, contact_phone: members[0].phone,
      new_family_name: familyId ? null : newFamilyName, head_index: familyId ? null : headIndex,
      members: members.map(x => ({ full_name: x.full_name, phone: x.phone, gender: x.gender,
        birth_year: x.birth_year, relationship: x.relationship })),
    } });
  } catch (e) {
    const message = String(e.message || '');
    const friendly = /jina hilo la familia/i.test(message) ? 'Jina hilo la familia lipo tayari. Chagua familia iliyopo.'
      : /tayari|duplicate|unique/i.test(message) ? 'Baadhi ya namba zimesajiliwa tayari. Hakiki namba za simu.'
      : /familia hiyo haipo/i.test(message) ? 'Familia uliyochagua si ya jumuiya hiyo. Chagua tena.'
      : /kigango na jumuiya/i.test(message) ? 'Kigango na jumuiya hazilingani. Chagua eneo tena.'
      : /simu sahihi|uhusiano|umri|jina,/i.test(message) ? message
      : 'Usajili haujakamilika. Hakiki taarifa kisha jaribu tena.';
    return json(res, 400, { error: friendly });
  }

  return json(res, 200, { ok: true, request_id: result, status: 'pending_review' });
};
