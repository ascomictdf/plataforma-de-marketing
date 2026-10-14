const { ensureDb, sql } = require('../_lib/db');
const { method, readBody } = require('../_lib/http');
const { mailConfigured, sendMail } = require('../_lib/mail');
const { issueResetLink, resetEmailHtml } = require('../_lib/reset');

const LINK_MINUTES = 30;

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    await ensureDb();
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase().replace(/\\@/g, '@');
    if (!email) return res.status(400).json({ error: 'MISSING_EMAIL' });
    const db = sql();
    const rows = await db`select id from app_users where email = ${email} limit 1`;
    // A resposta não revela se o e-mail tem conta: o modo de entrega depende só da configuração.
    let delivery = mailConfigured() ? 'email' : 'admin';
    let devLink = '';

    if (rows.length) {
      let sent = false;
      if (delivery === 'email') {
        const link = await issueResetLink(db, req, email, LINK_MINUTES);
        try {
          sent = await sendMail({
            to: email,
            subject: 'Redefinição de senha - Hub de Agentes IA',
            html: resetEmailHtml(link, LINK_MINUTES),
            text: `Para criar uma nova senha, acesse: ${link} (vale ${LINK_MINUTES} minutos).`
          });
        } catch (err) {
          console.error('Falha ao enviar e-mail de redefinição:', err);
        }
        if (!sent && process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') devLink = link;
      }
      if (!sent) {
        // Sem e-mail: o pedido fica registrado para o Admin Geral gerar o link em Configurações.
        delivery = 'admin';
        await db`update app_users set reset_requested_at = now(), updated_at = now() where email = ${email}`;
      }
    }

    return res.status(200).json({ ok: true, delivery, devLink });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'RESET_REQUEST_FAILED', message: err.message });
  }
};
