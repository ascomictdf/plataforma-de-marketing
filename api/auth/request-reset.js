const { ensureDb, sql } = require('../_lib/db');
const { randomToken, sha256 } = require('../_lib/auth');
const { method, readBody } = require('../_lib/http');

async function sendResetEmail(email, link) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: email,
      subject: 'Recuperação de senha - Hub de Agentes IA',
      html: `<p>Use este link para redefinir sua senha:</p><p><a href="${link}">${link}</a></p><p>O link expira em 30 minutos.</p>`
    })
  });
  return r.ok;
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    await ensureDb();
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase().replace(/\\@/g, '@');
    const db = sql();
    const rows = email ? await db`select id from app_users where email = ${email} limit 1` : [];
    let devLink = '';

    if (rows.length) {
      const token = randomToken();
      const tokenHash = sha256(token);
      await db`
        update app_users
        set reset_token_hash = ${tokenHash},
            reset_expires_at = now() + interval '30 minutes',
            updated_at = now()
        where email = ${email}
      `;
      const base = (process.env.APP_URL || `https://${req.headers.host || ''}`).replace(/\/+$/, '');
      const link = `${base}/?reset=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
      const sent = await sendResetEmail(email, link);
      if (!sent && process.env.NODE_ENV !== 'production') devLink = link;
    }

    return res.status(200).json({
      ok: true,
      message: 'Se o e-mail estiver cadastrado, enviaremos um link de recuperação.',
      devLink
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'RESET_REQUEST_FAILED', message: err.message });
  }
};
