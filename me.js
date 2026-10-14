const { ensureDb } = require('../_lib/db');
const { sessionUser } = require('../_lib/auth');
const { method } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    await ensureDb();
    const user = await sessionUser(req);
    return res.status(200).json({ authenticated: !!user, user: user ? { email: user.email, name: user.name, role: user.role } : null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'AUTH_CHECK_FAILED', message: err.message });
  }
};
