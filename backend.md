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
- `GET /api/users`
- `POST /api/users`
- `DELETE /api/users`
- `GET /api/state`
- `PUT /api/state`
- `GET /api/review`
- `POST /api/review`
- `GET /api/health`

O banco fica atrás da API da Vercel. Isso reduz problemas de CORS, chave exposta,
sessão local, políticas de acesso no cliente e desconexões por configuração do navegador.

O link de aprovação (`?aprovar=1`) usa `/api/review`, que é público apenas para leitura
do estado necessário e para registrar aprovação/solicitação de alteração de uma arte.
Assim outros setores conseguem aprovar sem criar login, enquanto a plataforma principal
continua exigindo autenticação.

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

Conta **Admin Geral** (altera login, senha e nível de acesso dos outros usuários):

```env
SUPERADMIN_EMAIL="thiago.silverio@ictdf.org.br"   # padrão, se não definido
SUPERADMIN_PASSWORD="senha-inicial"                # opcional: cria a conta se ainda não existir
```

Se a conta já existir no banco, ela recebe o papel `admin_geral` automaticamente. Se não existir
e `SUPERADMIN_PASSWORD` não estiver definida, basta um administrador cadastrá-la em
Configurações → Usuários e acessos — o papel `admin_geral` é aplicado sozinho.

Níveis de acesso: `admin_geral` · `admin` · `editor` · `visualizador`. Só o Admin Geral altera
usuários existentes (`PATCH /api/users`); administradores e editores apenas cadastram novos.

### Recuperação de senha ("Esqueci minha senha")

Funciona de duas formas:

1. **Com envio de e-mail configurado** — a pessoa recebe um link (válido por 30 minutos) e cria a nova senha.
   Configure **uma** das opções:

   ```env
   # Opção A: Resend
   RESEND_API_KEY="re_..."
   EMAIL_FROM="ICTDF <noreply@seudominio.com>"

   # Opção B: SMTP (Google Workspace, Microsoft 365 etc.)
   SMTP_HOST="smtp.gmail.com"          # Microsoft 365: smtp.office365.com
   SMTP_PORT="587"
   SMTP_USER="conta-de-envio@ictdf.org.br"
   SMTP_PASS="senha-de-app"            # use uma "senha de app", não a senha normal
   EMAIL_FROM="ICTDF <conta-de-envio@ictdf.org.br>"
   ```

2. **Sem envio de e-mail** — o pedido fica registrado para o **Admin Geral**, que recebe uma notificação
   e vê o pedido em Configurações → Usuários e acessos. No lápis da pessoa, ele clica em
   **Gerar link de nova senha** (válido por 24 horas) e envia o link por WhatsApp/e-mail. A própria pessoa
   escolhe a nova senha.

Quem já está logado também pode trocar a senha em Configurações → Sua conta → **Alterar minha senha**.
Endpoints: `POST /api/auth/request-reset`, `POST /api/auth/reset`, `POST /api/auth/change-password`
e `POST /api/users` com `{ "action": "reset-link", "email": "..." }` (só Admin Geral).

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
  name text,
  email text not null unique,
  password_hash text not null,
  role text not null default 'admin',
  reset_token_hash text,
  reset_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

O endpoint `GET /api/health` deve retornar `{"ok":true,"database":"connected"}` quando
as variáveis da Vercel e o Neon estiverem configurados corretamente.

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
