// Histórico de aprovação das artes (post.aprovHistorico): somente acréscimo.
// Entradas já gravadas no banco não podem ser editadas nem removidas pelo cliente.

function eachPost(data, fn) {
  (data && data.posts || []).forEach(fn);
  (data && data.campanhas || []).forEach(camp => (camp.posts || []).forEach(fn));
}

function cleanEntry(entry) {
  if (!entry || typeof entry !== 'object' || !entry.id) return null;
  return {
    id: String(entry.id).slice(0, 80),
    ts: String(entry.ts || new Date().toISOString()).slice(0, 40),
    status: String(entry.status || '').slice(0, 30),
    de: String(entry.de || '').slice(0, 30),
    autor: String(entry.autor || '').slice(0, 120),
    origem: String(entry.origem || '').slice(0, 30),
    comentario: String(entry.comentario || '').slice(0, 2000)
  };
}

// Junta o histórico gravado (imutável) com entradas novas enviadas pelo cliente.
function mergeApprovalHistory(previous, incoming) {
  const saved = new Map();
  eachPost(previous, post => saved.set(post.id, Array.isArray(post.aprovHistorico) ? post.aprovHistorico : []));
  eachPost(incoming, post => {
    const locked = saved.get(post.id) || [];
    const lockedIds = new Set(locked.map(e => e && e.id));
    const extra = (Array.isArray(post.aprovHistorico) ? post.aprovHistorico : [])
      .filter(e => e && e.id && !lockedIds.has(e.id))
      .map(cleanEntry)
      .filter(Boolean);
    const merged = locked.concat(extra);
    if (merged.length) post.aprovHistorico = merged.slice(-200);
    else delete post.aprovHistorico;
  });
  return incoming;
}

function historyId() {
  return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { mergeApprovalHistory, historyId };
