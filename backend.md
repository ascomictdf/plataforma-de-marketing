# Backend, Vercel e banco de dados

Esta versão deixou de depender de Supabase acessado diretamente pelo navegador.
Agora a plataforma foi preparada para rodar na **Vercel** com:

- Front-end: `index.html`
- APIs serverless: pasta `api/`
- Banco: **Neon Postgres** via **Vercel Marketplace → Storage**
- Login obrigatório: cookie HTTP-only emitido pelo servidor
- Recuperação de senha: endpoint próprio, com envio de e-mail opcional via Resend

## Por que essa estrutura é mais estável

Antes, o navegador chamava o banco diretamente e salvava todo o estado em um JSON remoto.
Agora o navegador chama apenas endpoints internos:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/request-reset`
- `POST /api/auth/reset`
- `GET /api/state`
- `PUT /api/state`

O banco fica atrás da API da Vercel. Isso reduz problemas de CORS, chave exposta,
sessão local, políticas de acesso no cliente e desconexões por configuração do navegador.

## Banco escolhido

Use **Neon Postgres** na aba **Storage** da Vercel.

Motivos:

- Está no Marketplace/Storage da Vercel.
- Injeta `DATABASE_URL` automaticamente no projeto.
- É Postgres serverless, adequado para funções serverless.
- Mantém os dados em tabelas reais, em vez de depender de `localStorage`.

## Variáveis de ambiente

Configure na Vercel em **Project Settings → Environment Variables**:

```env
DATABASE_URL="postgres://..."
AUTH_SECRET="gere-uma-chave-grande"
ADMIN_EMAIL="ascom@ictdf.org.br"
ADMIN_PASSWORD="ascomictdf"
APP_URL="https://seu-projeto.vercel.app"
```

Para recuperação de senha por e-mail real:

```env
RESEND_API_KEY="re_..."
EMAIL_FROM="ICTDF <noreply@seudominio.com>"
```

Sem `RESEND_API_KEY` e `EMAIL_FROM`, o endpoint de recuperação existe, mas não envia
e-mail em produção. Em ambiente local, ele pode devolver um link de teste.

## Usuário administrador

O primeiro acesso da API cria automaticamente o usuário:

- E-mail: `ascom@ictdf.org.br`
- Senha inicial: `ascomictdf`
- Papel: `admin`

Depois do primeiro login, use a opção **Esqueci minha senha** para redefinir quando
o envio de e-mail estiver configurado.

## Estrutura criada no banco

As APIs criam automaticamente estas tabelas:

```sql
create table if not exists app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists app_users (
  id bigserial primary key,
  email text not null unique,
  password_hash text not null,
  role text not null default 'admin',
  reset_token_hash text,
  reset_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## Deploy na Vercel

1. Rode `npm install`.
2. Crie/importe o projeto na Vercel.
3. Na Vercel, vá em **Storage → Create Database → Neon** e conecte ao projeto.
4. Confira se `DATABASE_URL` foi criada.
5. Configure `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `APP_URL`.
6. Faça o deploy.

Pelo CLI:

```bash
npx vercel login
npx vercel
npx vercel --prod
```

Neste ambiente atual, o CLI existe via `npx vercel`, mas ainda não há sessão ativa.
Será preciso fazer login ou usar `--token`.
