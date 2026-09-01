const bcrypt = require('bcryptjs');
const { ensureDb, sql } = require('./_lib/db');
const { requireAdmin } = require('./_lib/auth');
const { method, readBody } = require('./_lib/http');

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase().replace(/\\@/g, '@');
}

function cleanRole(value) {
  return ['admin', 'editor', 'visualizador'].includes(value) ? value : 'editor';
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;
  try {
    await ensureDb();
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const db = sql();

    if (req.method === 'GET') {
      const rows = await db`
        select name, email, role, created_at
        from app_users
        order by created_at asc
      `;
      return res.status(200).json({ users: rows });
    }

    const body = await readBody(req);
    const email = cleanEmail(body.email);

    if (req.method === 'DELETE') {
      if (!email) return res.status(400).json({ error: 'MISSING_EMAIL' });
      if (email === admin.email) return res.status(400).json({ error: 'CANNOT_DELETE_SELF' });
      await db`delete from app_users where email = ${email}`;
      return res.status(200).json({ ok: true });
    }

    const password = String(body.password || '');
    const name = String(body.nome || body.name || '').trim();
    const role = cleanRole(body.role);
    if (!email || password.length < 6) return res.status(400).json({ error: 'INVALID_USER_DATA' });

    const hash = await bcrypt.hash(password, 12);
    await db`
      insert into app_users (name, email, password_hash, role, updated_at)
      values (${name || email}, ${email}, ${hash}, ${role}, now())
      on conflict (email) do update
      set password_hash = excluded.password_hash,
          name = excluded.name,
          role = excluded.role,
          updated_at = now()
    `;
    return res.status(200).json({ ok: true, user: { name: name || email, email, role } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'USERS_FAILED', message: err.message });
  }
};
