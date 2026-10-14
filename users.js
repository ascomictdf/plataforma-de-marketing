const bcrypt = require('bcryptjs');
const { ensureDb, sql } = require('./_lib/db');
const { requireAdmin, ROLES, superAdminEmail } = require('./_lib/auth');
const { method, readBody } = require('./_lib/http');
const { issueResetLink } = require('./_lib/reset');

const RESET_LINK_MINUTES = 24 * 60;

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase().replace(/\@/g, '@');
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cleanRole(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ROLES.includes(value) ? value : null;
}

async function findUser(db, email) {
  const rows = await db`select id, name, email, role from app_users where email = ${email} limit 1`;
  return rows[0] || null;
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  try {
    await ensureDb();
    const actor = await requireAdmin(req, res);
    if (!actor) return;
    const isAdminGeral = actor.role === 'admin_geral';
    const db = sql();

    if (req.method === 'GET') {
      const rows = await db`
        select name, email, role, created_at, updated_at, reset_requested_at
        from app_users
        order by created_at asc
      `;
      return res.status(200).json({ users: rows, canManageLogins: isAdminGeral });
    }

    const body = await readBody(req);
    const email = cleanEmail(body.email);
    if (!email) return res.status(400).json({ error: 'MISSING_EMAIL' });

    if (req.method === 'DELETE') {
      if (email === cleanEmail(actor.email)) return res.status(400).json({ error: 'CANNOT_DELETE_SELF' });
      if (email === superAdminEmail()) return res.status(403).json({ error: 'SUPERADMIN_PROTECTED' });
      const target = await findUser(db, email);
      if (target && target.role === 'admin_geral' && !isAdminGeral) return res.status(403).json({ error: 'FORBIDDEN' });
      await db`delete from app_users where email = ${email}`;
      return res.status(200).json({ ok: true });
    }

    // PATCH: alterar login (e-mail), nome, senha e nível de acesso — exclusivo do Admin Geral.
    if (req.method === 'PATCH') {
      if (!isAdminGeral) return res.status(403).json({ error: 'ADMIN_GERAL_ONLY' });
      const target = await findUser(db, email);
      if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });

      const newEmail = body.newEmail !== undefined ? cleanEmail(body.newEmail) : target.email;
      if (!validEmail(newEmail)) return res.status(400).json({ error: 'INVALID_EMAIL' });
      const name = body.name !== undefined || body.nome !== undefined ? String(body.nome ?? body.name ?? '').trim().slice(0, 120) || newEmail : target.name;
      const role = cleanRole(body.role, target.role);
      if (!role) return res.status(400).json({ error: 'INVALID_ROLE' });
      const password = body.password ? String(body.password) : '';
      if (password && password.length < 6) return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });

      const isSuper = target.email === superAdminEmail();
      if (isSuper && newEmail !== target.email) return res.status(400).json({ error: 'SUPERADMIN_EMAIL_LOCKED' });
      if ((isSuper || String(target.id) === String(actor.id)) && role !== 'admin_geral') {
        return res.status(400).json({ error: 'CANNOT_DEMOTE_ADMIN_GERAL' });
      }
      if (newEmail !== target.email && await findUser(db, newEmail)) return res.status(409).json({ error: 'EMAIL_IN_USE' });

      await db`
        update app_users
        set email = ${newEmail}, name = ${name}, role = ${role}, updated_at = now()
        where id = ${target.id}
      `;
      if (password) {
        const hash = await bcrypt.hash(password, 12);
        await db`
          update app_users
          set password_hash = ${hash}, reset_token_hash = null, reset_expires_at = null, reset_requested_at = null, updated_at = now()
          where id = ${target.id}
        `;
      }
      return res.status(200).json({ ok: true, user: { name, email: newEmail, role }, passwordChanged: !!password });
    }

    // POST action=reset-link: Admin Geral gera um link para a própria pessoa criar a nova senha
    // (usado quando ela pediu "Esqueci minha senha" e não há envio de e-mail configurado).
    if (body.action === 'reset-link') {
      if (!isAdminGeral) return res.status(403).json({ error: 'ADMIN_GERAL_ONLY' });
      if (!(await findUser(db, email))) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      const link = await issueResetLink(db, req, email, RESET_LINK_MINUTES);
      await db`update app_users set reset_requested_at = null where email = ${email}`;
      return res.status(200).json({ ok: true, link, expiresInHours: RESET_LINK_MINUTES / 60 });
    }

    // POST: cadastrar usuário. Alterar um usuário já existente é exclusivo do Admin Geral.
    const password = String(body.password || '');
    const name = String(body.nome || body.name || '').trim();
    let role = cleanRole(body.role, 'editor');
    if (!role) return res.status(400).json({ error: 'INVALID_ROLE' });
    if (!validEmail(email) || password.length < 6) return res.status(400).json({ error: 'INVALID_USER_DATA' });
    if (role === 'admin_geral' && !isAdminGeral) return res.status(403).json({ error: 'ADMIN_GERAL_ONLY' });
    if (email === superAdminEmail()) role = 'admin_geral';

    const existing = await findUser(db, email);
    if (existing && !isAdminGeral) return res.status(409).json({ error: 'USER_EXISTS' });
    if (existing && String(existing.id) === String(actor.id) && role !== 'admin_geral') {
      return res.status(400).json({ error: 'CANNOT_DEMOTE_ADMIN_GERAL' });
    }

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
