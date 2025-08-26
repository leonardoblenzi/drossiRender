// middleware/ensureAccount.js
const { ACCOUNTS } = require('../routes/accountRoutes');

function getEnvCredsFor(key) {
  if (!key) return null;
  const U = String(key).toUpperCase();

  const app_id        = process.env[`ML_${U}_APP_ID`]        || process.env[`ML_${U}_CLIENT_ID`];
  const client_secret = process.env[`ML_${U}_CLIENT_SECRET`];
  const refresh_token = process.env[`ML_${U}_REFRESH_TOKEN`];
  const access_token  = process.env[`ML_${U}_ACCESS_TOKEN`];
  const redirect_uri  = process.env[`ML_${U}_REDIRECT_URI`] || process.env.ML_REDIRECT_URI || process.env.REDIRECT_URI;

  if (!app_id && !client_secret && !refresh_token && !access_token) return null;
  return { app_id, client_secret, refresh_token, access_token, redirect_uri };
}

function ensureAccount(req, res, next) {
  const open = ['/select-conta','/api/account','/api/system/health','/api/system/stats','/test-basic','/debug/routes','/public','/css','/js','/img','/assets'];
  if (open.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();

  const key = req.cookies?.ml_account;
  if (!key || !ACCOUNTS[key]) {
    const wantsHtml = req.accepts(['html','json']) === 'html';
    if (wantsHtml && req.method === 'GET') return res.redirect('/select-conta');
    return res.status(401).json({ ok:false, error:'Conta não selecionada', redirect:'/select-conta' });
  }

  res.locals.accountKey   = key;
  res.locals.accountLabel = ACCOUNTS[key]?.label || key;

  const creds = getEnvCredsFor(key) || {};
  creds.key = key;            // ajuda cache do TokenService
  creds.account_key = key;
  creds.__debugKey = key;     // logs [conta]
  res.locals.mlCreds = creds;

  // compat com código legado
  if (creds.access_token)  process.env.ACCESS_TOKEN  = creds.access_token;
  if (creds.app_id)        process.env.APP_ID        = String(creds.app_id);
  if (creds.client_secret) process.env.CLIENT_SECRET = String(creds.client_secret);
  if (creds.refresh_token) process.env.REFRESH_TOKEN = String(creds.refresh_token);
  if (creds.redirect_uri)  process.env.REDIRECT_URI  = String(creds.redirect_uri);

  next();
}

module.exports = ensureAccount;
