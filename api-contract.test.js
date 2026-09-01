const assert = require('assert');
const path = require('path');
const Module = require('module');
const bcrypt = require('bcryptjs');

process.env.AUTH_SECRET = 'test-secret';
process.env.ADMIN_EMAIL = 'ascom@ictdf.org.br';
process.env.ADMIN_PASSWORD = 'ascomictdf';

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
  if (q.startsWith('select id, email, password_hash, role from app_users')) {
    const email = values[0];
    return memory.users.filter(u => u.email === email).slice(0, 1);
  }
  if (q.startsWith('select name, email, role, created_at from app_users')) {
    return memory.users.map(({ name, email, role, created_at }) => ({ name, email, role, created_at }));
  }
  if (q.startsWith('insert into app_users')) {
    const hasName = values.length >= 4;
    const [name, email, password_hash, role] = hasName ? values : [null, ...values];
    const existing = memory.users.find(u => u.email === email);
    if (existing) Object.assign(existing, { name, password_hash, role });
    else memory.users.push({ id: memory.users.length + 1, name, email, password_hash, role, created_at: new Date().toISOString() });
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
  if (request.endsWith('/_lib/db') || request.endsWith('\\_lib\\db') || request === '../_lib/db' || request === './_lib/db') {
    return { ensureDb, sql: () => db };
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

  console.log('API contract tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
