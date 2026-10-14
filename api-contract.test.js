const assert = require('assert');
const path = require('path');
const Module = require('module');
const bcrypt = require('bcryptjs');

process.env.AUTH_SECRET = 'test-secret';
process.env.ADMIN_EMAIL = 'ascom@ictdf.org.br';
process.env.ADMIN_PASSWORD = 'ascomictdf';
process.env.APP_URL = 'https://hub.exemplo.org';

const memory = { users: [], state: null };

async function ensureDb() {
  if (!memory.users.some(u => u.email === process.env.ADMIN_EMAIL)) {
    memory.users.push({
      id: 1,
      name: 'Administrador',
      email: process.env.ADMIN_EMAIL,
      password_hash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 4),
      role: 'admin',
      created_at: new Date().toISOString()
    });
  }
}

function normalize(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function db(strings, ...values) {
  const q = normalize(strings);
  if (q.startsWith('select id, email, name, role from app_users where id')) {
    return memory.users.filter(u => String(u.id) === String(values[0])).slice(0, 1);
  }
  if (q.startsWith('select id, name, email, role from app_users where email')) {
    return memory.users.filter(u => u.email === values[0]).slice(0, 1);
  }
  if (q.startsWith('update app_users set email = ?, name = ?, role = ?')) {
    const [email, name, role, id] = values;
    const u = memory.users.find(x => String(x.id) === String(id));
    if (u) Object.assign(u, { email, name, role });
    return [];
  }
  if (q.startsWith('update app_users set password_hash = ?')) {
    const [password_hash, key] = values;
    const u = memory.users.find(x => String(x.id) === String(key) || x.email === key);
    if (u) Object.assign(u, { password_hash, reset_token_hash: null, reset_expires_at: null, reset_requested_at: null });
    return [];
  }
  if (q.startsWith('update app_users set reset_token_hash = ?')) {
    const [reset_token_hash, reset_expires_at, email] = values;
    const u = memory.users.find(x => x.email === email);
    if (u) Object.assign(u, { reset_token_hash, reset_expires_at });
    return [];
  }
  if (q.startsWith('update app_users set reset_requested_at = now()')) {
    const u = memory.users.find(x => x.email === values[0]);
    if (u) u.reset_requested_at = new Date().toISOString();
    return [];
  }
  if (q.startsWith('update app_users set reset_requested_at = null')) {
    const u = memory.users.find(x => x.email === values[0]);
    if (u) u.reset_requested_at = null;
    return [];
  }
  if (q.startsWith('select id from app_users where email = ? and reset_token_hash = ?')) {
    const [email, hash] = values;
    return memory.users.filter(u => u.email === email && u.reset_token_hash === hash && new Date(u.reset_expires_at) > new Date());
  }
  if (q.startsWith('select id from app_users where email = ?')) {
    return memory.users.filter(u => u.email === values[0]).slice(0, 1);
  }
  if (q.startsWith("update app_users set role = 'admin_geral'")) {
    const u = memory.users.find(x => String(x.id) === String(values[0]));
    if (u) u.role = 'admin_geral';
    return [];
  }
  if (q.startsWith('select id, email, password_hash, role from app_users')) {
    const email = values[0];
    return memory.users.filter(u => u.email === email).slice(0, 1);
  }
  if (q.startsWith('select name, email, role, created_at')) {
    return memory.users.map(({ name, email, role, created_at, reset_requested_at }) => ({ name, email, role, created_at, reset_requested_at: reset_requested_at || null }));
  }
  if (q.startsWith('insert into app_users')) {
    const hasName = values.length >= 4;
    const [name, email, password_hash, role] = hasName ? values : [null, ...values];
    const existing = memory.users.find(u => u.email === email);
    if (existing) Object.assign(existing, { name, password_hash, role });
    else memory.users.push({ id: Math.max(0, ...memory.users.map(u => u.id)) + 1, name, email, password_hash, role, created_at: new Date().toISOString() });
    return [];
  }
  if (q.startsWith('alter table app_users')) return [];
  if (q.startsWith('select now() as now')) return [{ now: new Date().toISOString() }];
  if (q.startsWith('delete from app_users')) {
    const email = values[0];
    memory.users = memory.users.filter(u => u.email !== email);
    return [];
  }
  if (q.startsWith('select data from app_state')) {
    return memory.state ? [{ data: memory.state }] : [];
  }
  if (q.startsWith('insert into app_state')) {
    memory.state = JSON.parse(values[0]);
    return [];
  }
  return [];
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request.endsWith('/_lib/db') || request.endsWith('\\_lib\\db') || request === '../_lib/db' || request === './_lib/db' || (request === './db' && /_lib/.test(parent && parent.filename || ''))) {
    return { ensureDb, sql: () => db, superAdminEmail: () => 'thiago.silverio@ictdf.org.br' };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function req(method, body, cookie) {
  return { method, body, headers: cookie ? { cookie } : {} };
}

function res() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    json(value) { this.payload = value; return this; }
  };
}

async function call(handler, method, body, cookie) {
  const response = res();
  await handler(req(method, body, cookie), response);
  return response;
}

(async () => {
  const login = require(path.join('..', 'api', 'auth', 'login'));
  const me = require(path.join('..', 'api', 'auth', 'me'));
  const users = require(path.join('..', 'api', 'users'));
  const state = require(path.join('..', 'api', 'state'));
  const requestReset = require(path.join('..', 'api', 'auth', 'request-reset'));
  const resetPass = require(path.join('..', 'api', 'auth', 'reset'));
  const changePass = require(path.join('..', 'api', 'auth', 'change-password'));
  const review = require(path.join('..', 'api', 'review'));

  const adminLogin = await call(login, 'POST', { email: 'ascom@ictdf.org.br', password: 'ascomictdf' });
  assert.equal(adminLogin.statusCode, 200, 'admin login deve funcionar');
  const adminCookie = adminLogin.headers['set-cookie'];
  assert.ok(adminCookie && adminCookie.includes('ictdf_session='), 'login deve emitir cookie');

  const session = await call(me, 'GET', null, adminCookie);
  assert.equal(session.payload.authenticated, true, 'sessao admin deve ser reconhecida');

  const created = await call(users, 'POST', { email: 'editor@ictdf.org.br', password: 'senha123', role: 'editor' }, adminCookie);
  assert.equal(created.statusCode, 200, 'admin deve criar usuario');

  const list = await call(users, 'GET', null, adminCookie);
  assert.ok(list.payload.users.some(u => u.email === 'editor@ictdf.org.br'), 'usuario criado deve aparecer na lista');

  const editorLogin = await call(login, 'POST', { email: 'editor@ictdf.org.br', password: 'senha123' });
  assert.equal(editorLogin.statusCode, 200, 'novo usuario deve conseguir login');

  const saved = await call(state, 'PUT', { data: { agents: [{ id: 'a1', nome: 'Agente Teste' }], tarefas: [] } }, adminCookie);
  assert.equal(saved.statusCode, 200, 'admin deve salvar estado');

  const loaded = await call(state, 'GET', null, adminCookie);
  assert.equal(loaded.payload.data.agents[0].nome, 'Agente Teste', 'estado salvo deve ser lido do banco');

  await call(state, 'PUT', { data: { agents: [], campanhas: [{ id: 'c1', posts: [{ id: 'p1', titulo: 'Arte Teste', aprov: 'pendente' }] }], posts: [] } }, adminCookie);
  const publicReview = await call(review, 'POST', { postId: 'p1', status: 'aprovado', revisor: 'Diretoria' });
  assert.equal(publicReview.statusCode, 200, 'link publico deve aprovar sem login');
  const reviewed = await call(state, 'GET', null, adminCookie);
  assert.equal(reviewed.payload.data.campanhas[0].posts[0].aprov, 'aprovado', 'aprovacao publica deve gravar no banco');

  const viewer = await call(users, 'POST', { email: 'viewer@ictdf.org.br', password: 'senha123', role: 'visualizador' }, adminCookie);
  assert.equal(viewer.statusCode, 200, 'admin deve criar visualizador');
  const viewerLogin = await call(login, 'POST', { email: 'viewer@ictdf.org.br', password: 'senha123' });
  const blocked = await call(state, 'PUT', { data: { agents: [] } }, viewerLogin.headers['set-cookie']);
  assert.equal(blocked.statusCode, 403, 'visualizador nao deve gravar estado');

  // ===== Admin Geral =====
  const superCreated = await call(users, 'POST', { nome: 'Thiago Silvério', email: 'thiago.silverio@ictdf.org.br', password: 'senha123', role: 'editor' }, adminCookie);
  assert.equal(superCreated.statusCode, 200, 'admin deve conseguir cadastrar a conta do Admin Geral');
  assert.equal(superCreated.payload.user.role, 'admin_geral', 'conta do Admin Geral recebe o papel automaticamente');

  const adminPatch = await call(users, 'PATCH', { email: 'editor@ictdf.org.br', password: 'outra123' }, adminCookie);
  assert.equal(adminPatch.statusCode, 403, 'admin comum nao altera senha de outros');
  const adminOverwrite = await call(users, 'POST', { email: 'editor@ictdf.org.br', password: 'outra123', role: 'admin' }, adminCookie);
  assert.equal(adminOverwrite.statusCode, 409, 'admin comum nao sobrescreve usuario existente');
  const adminMakesSuper = await call(users, 'POST', { email: 'novo@ictdf.org.br', password: 'senha123', role: 'admin_geral' }, adminCookie);
  assert.equal(adminMakesSuper.statusCode, 403, 'admin comum nao cria Admin Geral');

  const superLogin = await call(login, 'POST', { email: 'thiago.silverio@ictdf.org.br', password: 'senha123' });
  assert.equal(superLogin.statusCode, 200, 'Admin Geral deve conseguir login');
  assert.equal(superLogin.payload.user.role, 'admin_geral');
  const superCookie = superLogin.headers['set-cookie'];

  const superList = await call(users, 'GET', null, superCookie);
  assert.equal(superList.payload.canManageLogins, true, 'Admin Geral gerencia logins');

  const changed = await call(users, 'PATCH', { email: 'editor@ictdf.org.br', newEmail: 'editor2@ictdf.org.br', nome: 'Editor Dois', password: 'nova1234', role: 'visualizador' }, superCookie);
  assert.equal(changed.statusCode, 200, 'Admin Geral altera login, senha e acesso');
  const oldPass = await call(login, 'POST', { email: 'editor2@ictdf.org.br', password: 'senha123' });
  assert.equal(oldPass.statusCode, 401, 'senha antiga deixa de valer');
  const newPass = await call(login, 'POST', { email: 'editor2@ictdf.org.br', password: 'nova1234' });
  assert.equal(newPass.statusCode, 200, 'nova senha e novo login funcionam');
  const demotedWrite = await call(state, 'PUT', { data: { agents: [] } }, editorLogin.headers['set-cookie']);
  assert.equal(demotedWrite.statusCode, 403, 'mudanca de acesso vale na hora, mesmo com sessao antiga');

  const selfDemote = await call(users, 'PATCH', { email: 'thiago.silverio@ictdf.org.br', role: 'editor' }, superCookie);
  assert.equal(selfDemote.statusCode, 400, 'Admin Geral nao pode se rebaixar');
  const delSuper = await call(users, 'DELETE', { email: 'thiago.silverio@ictdf.org.br' }, adminCookie);
  assert.equal(delSuper.statusCode, 403, 'conta do Admin Geral e protegida');

  // ===== Esqueci minha senha (sem e-mail configurado: pedido vai para o Admin Geral) =====
  delete process.env.RESEND_API_KEY; delete process.env.SMTP_HOST;
  const asked = await call(requestReset, 'POST', { email: 'viewer@ictdf.org.br' });
  assert.equal(asked.statusCode, 200);
  assert.equal(asked.payload.delivery, 'admin', 'sem e-mail configurado, o pedido vai para o Admin Geral');
  const unknown = await call(requestReset, 'POST', { email: 'ninguem@ictdf.org.br' });
  assert.equal(unknown.payload.delivery, 'admin', 'resposta igual para e-mail inexistente');
  const pending = (await call(users, 'GET', null, superCookie)).payload.users.find(u => u.email === 'viewer@ictdf.org.br');
  assert.ok(pending.reset_requested_at, 'Admin Geral ve o pedido de nova senha');

  const noLinkForAdmin = await call(users, 'POST', { action: 'reset-link', email: 'viewer@ictdf.org.br' }, adminCookie);
  assert.equal(noLinkForAdmin.statusCode, 403, 'so o Admin Geral gera link de redefinicao');
  const linkRes = await call(users, 'POST', { action: 'reset-link', email: 'viewer@ictdf.org.br' }, superCookie);
  assert.equal(linkRes.statusCode, 200);
  const token = new URL(linkRes.payload.link).searchParams.get('reset');
  assert.ok(token, 'link contem o token');

  const shortPass = await call(resetPass, 'POST', { email: 'viewer@ictdf.org.br', token, password: '123' });
  assert.equal(shortPass.payload.error, 'PASSWORD_TOO_SHORT', 'senha curta e recusada');
  const resetOk = await call(resetPass, 'POST', { email: 'viewer@ictdf.org.br', token, password: 'recuperada1' });
  assert.equal(resetOk.statusCode, 200, 'mesmo link funciona depois de um erro');
  assert.equal((await call(login, 'POST', { email: 'viewer@ictdf.org.br', password: 'recuperada1' })).statusCode, 200, 'nova senha funciona');
  const reused = await call(resetPass, 'POST', { email: 'viewer@ictdf.org.br', token, password: 'outra999' });
  assert.equal(reused.statusCode, 400, 'link nao pode ser reutilizado');

  // ===== Alterar a propria senha (logado) =====
  const viewerCookie = (await call(login, 'POST', { email: 'viewer@ictdf.org.br', password: 'recuperada1' })).headers['set-cookie'];
  const wrong = await call(changePass, 'POST', { currentPassword: 'errada', newPassword: 'minha2026' }, viewerCookie);
  assert.equal(wrong.payload.error, 'WRONG_PASSWORD');
  const changedOwn = await call(changePass, 'POST', { currentPassword: 'recuperada1', newPassword: 'minha2026' }, viewerCookie);
  assert.equal(changedOwn.statusCode, 200, 'usuario troca a propria senha');
  assert.equal((await call(login, 'POST', { email: 'viewer@ictdf.org.br', password: 'minha2026' })).statusCode, 200);

  // ===== Historico de aprovacao travado =====
  await call(state, 'PUT', { data: { agents: [], campanhas: [], posts: [{ id: 'p2', titulo: 'Arte 2', aprov: 'pendente' }] } }, adminCookie);
  const noComment = await call(review, 'POST', { postId: 'p2', status: 'alteracao', revisor: 'Diretoria' });
  assert.equal(noComment.statusCode, 400, 'solicitacao de alteracao exige descricao');
  const change = await call(review, 'POST', { postId: 'p2', status: 'alteracao', revisor: 'Diretoria', comentario: 'Trocar a cor do fundo' });
  assert.equal(change.statusCode, 200);
  const afterReview = (await call(state, 'GET', null, adminCookie)).payload.data;
  const entry = afterReview.posts[0].aprovHistorico[0];
  assert.equal(entry.comentario, 'Trocar a cor do fundo', 'historico guarda o texto da solicitacao');
  assert.ok(entry.ts && entry.autor === 'Diretoria', 'historico guarda data/hora e autor');

  const tampered = JSON.parse(JSON.stringify(afterReview));
  tampered.posts[0].aprovHistorico = [{ ...entry, comentario: 'texto adulterado' }, { id: 'local1', ts: new Date().toISOString(), status: 'pendente', autor: 'Equipe', comentario: '' }];
  await call(state, 'PUT', { data: tampered }, adminCookie);
  const hist = (await call(state, 'GET', null, adminCookie)).payload.data.posts[0].aprovHistorico;
  assert.equal(hist[0].comentario, 'Trocar a cor do fundo', 'texto da solicitacao nao pode ser editado');
  assert.equal(hist.length, 2, 'novas entradas sao acrescentadas');
  tampered.posts[0].aprovHistorico = [];
  await call(state, 'PUT', { data: tampered }, adminCookie);
  const hist2 = (await call(state, 'GET', null, adminCookie)).payload.data.posts[0].aprovHistorico;
  assert.equal(hist2.length, 2, 'historico nao pode ser apagado pelo cliente');

  console.log('API contract tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
