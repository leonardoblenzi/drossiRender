// middleware/ensureAccount.js
// Garante que uma conta foi selecionada e injeta credenciais em res.locals.mlCreds

// Evita quebra se accountRoutes ainda não estiver disponível (ciclo)
let ACCOUNTS = {};
try {
  ACCOUNTS = require('../routes/accountRoutes').ACCOUNTS || {};
} catch (_) {
  ACCOUNTS = {};
}

function getEnvCredsFor(key) {
  if (!key) return null;
  const U = String(key).toUpperCase();

  const app_id =
    process.env[`ML_${U}_APP_ID`] ||
    process.env[`ML_${U}_CLIENT_ID`];

  const client_secret = process.env[`ML_${U}_CLIENT_SECRET`];
  const refresh_token = process.env[`ML_${U}_REFRESH_TOKEN`];
  const access_token  = process.env[`ML_${U}_ACCESS_TOKEN`];

  const redirect_uri =
    process.env[`ML_${U}_REDIRECT_URI`] ||
    process.env.ML_REDIRECT_URI ||
    process.env.REDIRECT_URI;

  if (!app_id && !client_secret && !refresh_token && !access_token) return null;
  return { app_id, client_secret, refresh_token, access_token, redirect_uri };
}

const OPEN_PREFIXES = [
  '/select-conta',
  '/api/account',           // /api/account/current etc.
  '/api/system/health',
  '/api/system/stats',
  '/api/health',
  '/health',
  '/favicon.ico',
  '/robots.txt',
  '/test-basic',
  '/debug/routes',
  '/public',
  '/css',
  '/js',
  '/img',
  '/assets',
  '/_next',                 // caso use Next em algum ponto
  '/static',
];

const SKIP_METHODS = new Set(['OPTIONS', 'HEAD']);

function isOpen(req) {
  if (SKIP_METHODS.has(req.method)) return true;
  const p = req.path || req.originalUrl || '';
  return OPEN_PREFIXES.some((base) => p === base || p.startsWith(base + '/'));
}

function ensureAccount(req, res, next) {
  if (isOpen(req)) return next();

  // cookies pode não existir se cookie-parser não estiver habilitado – use com optional chaining
  const key = req.cookies?.ml_account;

  if (!key || !ACCOUNTS[key]) {
    const wantsHtml = req.accepts(['html', 'json']) === 'html';
    if (wantsHtml && req.method === 'GET') {
      return res.redirect('/select-conta');
    }
    return res
      .status(401)
      .json({ ok: false, error: 'Conta não selecionada', redirect: '/select-conta' });
  }

  // Identidade da conta para logs/UI
  res.locals.accountKey   = key;
  res.locals.accountLabel = (ACCOUNTS[key] && ACCOUNTS[key].label) || key;

  // Semeia credenciais dessa conta a partir do ambiente
  const creds = getEnvCredsFor(key) || {};
  creds.key = key;              // pode ajudar caches
  creds.account_key = key;      // usado no TokenService/logs
  creds.__debugKey = key;

  // Garante o bag de credenciais
  res.locals.mlCreds = Object.assign({}, res.locals.mlCreds || {}, creds);

  // Compat com código legado que lê direto de ENV
  if (creds.access_token)  process.env.ACCESS_TOKEN  = creds.access_token;
  if (creds.app_id)        process.env.APP_ID        = String(creds.app_id);
  if (creds.client_secret) process.env.CLIENT_SECRET = String(creds.client_secret);
  if (creds.refresh_token) process.env.REFRESH_TOKEN = String(creds.refresh_token);
  if (creds.redirect_uri)  process.env.REDIRECT_URI  = String(creds.redirect_uri);

  next();
}

module.exports = ensureAccount;
