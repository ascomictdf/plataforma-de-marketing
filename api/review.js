const { ensureDb, sql } = require('./_lib/db');
const { method, readBody } = require('./_lib/http');

function updatePostInData(data, postId, patch) {
  let changed = false;
  const apply = post => {
    if (post && post.id === postId) {
      Object.assign(post, patch);
      changed = true;
    }
  };
  (data.posts || []).forEach(apply);
  (data.campanhas || []).forEach(camp => (camp.posts || []).forEach(apply));
  return changed;
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    await ensureDb();
    const db = sql();
    const rows = await db`select data from app_state where id = 'main' limit 1`;
    const data = rows[0] ? rows[0].data : null;

    if (req.method === 'GET') {
      return res.status(200).json({ data });
    }

    const body = await readBody(req);
    const postId = String(body.postId || '');
    const status = String(body.status || '');
    const revisor = String(body.revisor || '').trim().slice(0, 120);
    const comentario = String(body.comentario || '').trim().slice(0, 2000);
    if (!data || !postId || !['aprovado', 'alteracao'].includes(status) || !revisor) {
      return res.status(400).json({ error: 'INVALID_REVIEW_DATA' });
    }

    const patch = {
      aprov: status,
      revisadoPor: revisor,
      revisadoEm: new Date().toISOString()
    };
    if (status === 'alteracao') patch.aprovComentario = comentario;
    if (status === 'aprovado') patch.aprovComentario = '';

    const changed = updatePostInData(data, postId, patch);
    if (!changed) return res.status(404).json({ error: 'POST_NOT_FOUND' });

    await db`
      insert into app_state (id, data, updated_at)
      values ('main', ${JSON.stringify(data)}::jsonb, now())
      on conflict (id) do update set data = excluded.data, updated_at = now()
    `;
    return res.status(200).json({ ok: true, patch });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'REVIEW_FAILED', message: err.message });
  }
};
