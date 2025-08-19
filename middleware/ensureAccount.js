// middleware/ensureAccount.js
const { ACCOUNTS } = require('../routes/accountRoutes');

/**
 * Lê credenciais da .env para a conta informada.
 * Mapeia para as chaves que o TokenService entende (app_id, client_secret, refresh_token, access_token, redirect_uri)
 */
function getEnvCredsFor(key) {
  if (!key) return null;
  const U = String(key).toUpperCase(); // drossi -> DROSSI, rossidecor -> ROSSIDECOR, etc.

  const app_id        = process.env[`ML_${U}_APP_ID`];
  const client_secret = process.env[`ML_${U}_CLIENT_SECRET`];
  const refresh_token = process.env[`ML_${U}_REFRESH_TOKEN`];
  const access_token  = process.env[`ML_${U}_ACCESS_TOKEN`];
  const redirect_uri  = process.env[`ML_${U}_REDIRECT_URI`] || process.env.ML_REDIRECT_URI || process.env.REDIRECT_URI;

  if (!app_id && !client_secret && !refresh_token && !access_token) {
    return null;
  }

  return {
    app_id,
    client_secret,
    refresh_token,
    access_token,
    redirect_uri
  };
}

function ensureAccount(req, res, next) {
  // Rotas abertas (seleção de conta e APIs auxiliares)
  const openPaths = [
    '/select-conta',
    '/api/account',
    '/api/system/health',
    '/api/system/stats',
    '/test-basic',
    '/debug/routes'
  ];
  if (openPaths.some(p => req.path === p || req.path.startsWith(p + '/'))) {
    return next();
  }

  const key = req.cookies?.ml_account;
  if (!key || !ACCOUNTS[key]) {
    // Se for requisição de página (HTML), redireciona para a seleção
    const wantsHtml = req.accepts(['html', 'json']) === 'html';
    if (wantsHtml && req.method === 'GET') {
      return res.redirect('/select-conta');
    }
    // Caso API -> responde 401 com dica de redirecionamento
    return res.status(401).json({
      ok: false,
      error: 'Conta não selecionada',
      redirect: '/select-conta',
    });
  }

  // Metadados da conta
  res.locals.accountKey   = key;
  res.locals.accountLabel = ACCOUNTS[key]?.label || key;

  // Credenciais da conta (lidas da .env)
  const creds = getEnvCredsFor(key);

  // >>>>>>> ADIÇÃO PARA LOGAR A CONTA CORRETA <<<<<<<
  if (creds) creds.__debugKey = key; // faz o TokenService logar [drossi], [diplany], [rossidecor]
  // >>>>>>> FIM DA ADIÇÃO <<<<<<<

  res.locals.mlCreds = creds || {};

  // Compat com código legado que lê direto de process.env
  if (creds?.access_token)  process.env.ACCESS_TOKEN   = creds.access_token;
  if (creds?.app_id)        process.env.APP_ID         = String(creds.app_id);
  if (creds?.client_secret) process.env.CLIENT_SECRET  = String(creds.client_secret);
  if (creds?.refresh_token) process.env.REFRESH_TOKEN  = String(creds.refresh_token);
  if (creds?.redirect_uri)  process.env.REDIRECT_URI   = String(creds.redirect_uri);

  return next();
}

module.exports = ensureAccount;
