// Shared server-side SMS transport for Beem Africa and NextSMS.
const provider = () => {
  const p = String(process.env.SMS_PROVIDER || '').toLowerCase();
  const sender = process.env.SMS_SENDER_ID || '';
  if (p === 'beem' && process.env.BEEM_API_KEY && process.env.BEEM_SECRET_KEY && sender) return { name: 'beem', label: 'Beem Africa', sender };
  if (p === 'nextsms' && process.env.NEXTSMS_USERNAME && process.env.NEXTSMS_PASSWORD && sender) return { name: 'nextsms', label: 'NextSMS', sender };
  return null;
};
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

async function sendChunk(prov, text, phones) {
  if (!phones.length) return { ok: true, status: 200, body: {} };
  if (prov.name === 'beem') {
    const res = await fetch('https://apisms.beem.africa/v1/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: basic(process.env.BEEM_API_KEY, process.env.BEEM_SECRET_KEY) },
      body: JSON.stringify({ source_addr: prov.sender, schedule_time: '', encoding: 0, message: text,
        recipients: phones.map((dest_addr, i) => ({ recipient_id: i + 1, dest_addr })) }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.successful !== false, status: res.status, body };
  }
  const res = await fetch('https://messaging-service.co.tz/api/sms/v1/text/single', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: basic(process.env.NEXTSMS_USERNAME, process.env.NEXTSMS_PASSWORD) },
    body: JSON.stringify({ from: prov.sender, to: phones, text }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function sendPersonalizedChunk(prov, messages) {
  if (!messages.length) return { ok: true, status: 200, body: {} };
  if (prov.name !== 'nextsms') return { ok: false, status: 400, error: 'Mtoa huduma huyu hatumii batch ya ujumbe binafsi.' };
  const res = await fetch('https://messaging-service.co.tz/api/sms/v1/text/multi', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: basic(process.env.NEXTSMS_USERNAME, process.env.NEXTSMS_PASSWORD) },
    body: JSON.stringify({ messages: messages.map(({ phone, text }) => ({ from: prov.sender, to: phone, text })) }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

module.exports = { provider, sendChunk, sendPersonalizedChunk };
