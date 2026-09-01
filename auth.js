const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const COOKIE_NAME = 'ictdf_session';

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

function requireUser(req, res) {
  const user = currentUser(req);
  if (user) return user;
  res.status(401).json({ error: 'UNAUTHORIZED' });
  return null;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (['admin', 'editor'].includes(user.role)) return user;
  res.status(403).json({ error: 'FORBIDDEN' });
  return null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

module.exports = { signSession, setSessionCookie, clearSessionCookie, currentUser, requireUser, requireAdmin, sha256, randomToken };
