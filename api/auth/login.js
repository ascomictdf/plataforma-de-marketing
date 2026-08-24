const bcrypt = require('bcryptjs');
const { ensureDb, sql } = require('../_lib/db');
const { signSession, setSessionCookie } = require('../_lib/auth');
const { method, readBody } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    await ensureDb();
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase().replace(/\\@/g, '@');
    const password = String(body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'MISSING_CREDENTIALS' });

    const db = sql();
    const rows = await db`select id, email, password_hash, role from app_users where email = ${email} limit 1`;
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }

    setSessionCookie(res, signSession(user));
    return res.status(200).json({ ok: true, user: { email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'LOGIN_FAILED', message: err.message });
  }
};
