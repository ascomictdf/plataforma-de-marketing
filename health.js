const { ensureDb, sql } = require('./_lib/db');
const { method } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    await ensureDb();
    const rows = await sql()`select now() as now`;
    return res.status(200).json({ ok: true, database: 'connected', now: rows[0] && rows[0].now });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, database: 'error', message: err.message });
  }
};
