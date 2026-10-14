const bcrypt = require('bcryptjs');
const { ensureDb, sql } = require('../_lib/db');
const { sha256 } = require('../_lib/auth');
const { method, readBody } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    await ensureDb();
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase().replace(/\\@/g, '@');
    const token = String(body.token || '');
    const password = String(body.password || '');
    if (!email || !token) return res.status(400).json({ error: 'INVALID_RESET_DATA' });
    if (password.length < 6) return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });

    const tokenHash = sha256(token);
    const db = sql();
    const rows = await db`
      select id from app_users
      where email = ${email}
        and reset_token_hash = ${tokenHash}
        and reset_expires_at > now()
      limit 1
    `;
    if (!rows.length) return res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });

    const passwordHash = await bcrypt.hash(password, 12);
    await db`
      update app_users
      set password_hash = ${passwordHash},
          reset_token_hash = null,
          reset_expires_at = null,
          reset_requested_at = null,
          updated_at = now()
      where email = ${email}
    `;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'RESET_FAILED', message: err.message });
  }
};
