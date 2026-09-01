const { clearSessionCookie } = require('../_lib/auth');
const { method } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
};
