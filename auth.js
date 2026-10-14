const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sql, superAdminEmail } = require('./db');

const COOKIE_NAME = 'ictdf_session';

// Papéis: admin_geral (gerencia logins/senhas/acessos de todos), admin, editor, visualizador
const ROLES = ['admin_geral', 'admin', 'editor', 'visualizador'];
const WRITE_ROLES = ['admin_geral', 'admin', 'editor'];

function authSecret() {
  return process.env.AUTH_SECRET || 'dev-only-change-this-secret-before-production';
}

function signSession(user) {
  return jwt.sign(
    { sub: String(user.id), email: user.email, role: user.role || 'admin' },
    authSecret(),
    { expiresIn: '8h' }
  );
}

function cookieOptions(maxAge) {
  const secure = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  return [
    `${COOKIE_NAME}=`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    secure ? 'Secure' : '',
    typeof maxAge === 'number' ? `Max-Age=${maxAge}` : ''
  ].filter(Boolean).join('; ');
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', cookieOptions(8 * 60 * 60).replace(`${COOKIE_NAME}=`, `${COOKIE_NAME}=${token}`));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookieOptions(0));
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const i = part.indexOf('=');
    return [decodeURIComponent(part.slice(0, i).trim()), decodeURIComponent(part.slice(i + 1).trim())];
  }));
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  try { return jwt.verify(token, authSecret()); }
  catch (_) { return null; }
}

// Confere a sessão no banco: e-mail, nome e papel atuais (mudanças de acesso valem na hora;
// usuário removido perde o acesso mesmo com cookie válido).
async function sessionUser(req) {
  const session = currentUser(req);
  if (!session) return null;
  const rows = await sql()`select id, email, name, role from app_users where id = ${session.sub} limit 1`;
  const row = rows[0];
  if (!row) return null;
  return { sub: String(row.id), id: row.id, email: row.email, name: row.name || row.email, role: row.role };
}

async function requireUser(req, res) {
  const user = await sessionUser(req);
  if (user) return user;
  res.status(401).json({ error: 'UNAUTHORIZED' });
  return null;
}

async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (WRITE_ROLES.includes(user.role)) return user;
  res.status(403).json({ error: 'FORBIDDEN' });
  return null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

module.exports = {
  ROLES, WRITE_ROLES, superAdminEmail,
  signSession, setSessionCookie, clearSessionCookie, currentUser, sessionUser,
  requireUser, requireAdmin, sha256, randomToken
};
