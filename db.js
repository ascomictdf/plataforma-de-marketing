const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');

let sqlClient;

// Conta "Admin Geral": pode alterar login, senha e nível de acesso de todos os usuários.
function superAdminEmail() {
  return (process.env.SUPERADMIN_EMAIL || 'thiago.silverio@ictdf.org.br').trim().toLowerCase();
}
let initPromise;

function sql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL ausente. Conecte o Neon Postgres na aba Storage da Vercel.');
  if (!sqlClient) sqlClient = neon(url);
  return sqlClient;
}

async function ensureDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = sql();
    await db`
      create table if not exists app_state (
        id text primary key,
        data jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      )
    `;
    await db`
      create table if not exists app_users (
        id bigserial primary key,
        name text,
        email text not null unique,
        password_hash text not null,
        role text not null default 'admin',
        reset_token_hash text,
        reset_expires_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await db`alter table app_users add column if not exists name text`;
    await db`alter table app_users add column if not exists reset_requested_at timestamptz`;

    const email = (process.env.ADMIN_EMAIL || 'ascom@ictdf.org.br').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'ascomictdf';
    const exists = await db`select id from app_users where email = ${email} limit 1`;
    if (!exists.length) {
      const hash = await bcrypt.hash(password, 12);
      await db`insert into app_users (name, email, password_hash, role) values ('Administrador', ${email}, ${hash}, 'admin')`;
    }

    // Garante o papel admin_geral para a conta definida em SUPERADMIN_EMAIL.
    // Se ela ainda não existir e SUPERADMIN_PASSWORD estiver definida, é criada aqui;
    // caso contrário, qualquer administrador pode cadastrá-la e o papel é aplicado automaticamente.
    const superEmail = superAdminEmail();
    const superRows = await db`select id from app_users where email = ${superEmail} limit 1`;
    if (superRows.length) {
      await db`update app_users set role = 'admin_geral', updated_at = now() where email = ${superEmail} and role <> 'admin_geral'`;
    } else if (process.env.SUPERADMIN_PASSWORD) {
      const hash = await bcrypt.hash(process.env.SUPERADMIN_PASSWORD, 12);
      await db`insert into app_users (name, email, password_hash, role) values ('Thiago Silvério', ${superEmail}, ${hash}, 'admin_geral')`;
    }
  })();
  return initPromise;
}

module.exports = { sql, ensureDb, superAdminEmail };
