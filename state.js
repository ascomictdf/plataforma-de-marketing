const { ensureDb, sql } = require('./_lib/db');
const { requireUser, requireAdmin } = require('./_lib/auth');
const { method, readBody } = require('./_lib/http');
const { mergeApprovalHistory } = require('./_lib/history');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'PUT'])) return;
  try {
    await ensureDb();
    const user = req.method === 'GET' ? await requireUser(req, res) : await requireAdmin(req, res);
    if (!user) return;

    const db = sql();
    const rows = await db`select data from app_state where id = 'main' limit 1`;
    const current = rows[0] ? rows[0].data : null;

    if (req.method === 'GET') {
      return res.status(200).json({ data: current });
    }

    const body = await readBody(req);
    const data = mergeApprovalHistory(current, body && body.data ? body.data : {});
    await db`
      insert into app_state (id, data, updated_at)
      values ('main', ${JSON.stringify(data)}::jsonb, now())
      on conflict (id) do update set data = excluded.data, updated_at = now()
    `;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'STATE_FAILED', message: err.message });
  }
};
