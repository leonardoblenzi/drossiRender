// routes/accountRoutes.js
const express = require('express');
const router = express.Router();

/** Mapeamento das contas disponíveis */
const ACCOUNTS = {
  drossi:     { label: 'DRossi Interiores', envPrefix: 'ML_DROSSI' },
  diplany:    { label: 'Diplany',           envPrefix: 'ML_DIPLANY' },
  rossidecor: { label: 'Rossi Decor',       envPrefix: 'ML_ROSSIDECOR' }
};

/** Helper: checa se a conta tem variáveis mínimas configuradas */
function accountConfigured(envPrefix) {
  const hasClient = !!process.env[`${envPrefix}_APP_ID`] || !!process.env[`${envPrefix}_CLIENT_ID`];
  const hasSecret = !!process.env[`${envPrefix}_CLIENT_SECRET`];
  const hasTokens = !!process.env[`${envPrefix}_ACCESS_TOKEN`] || !!process.env[`${envPrefix}_REFRESH_TOKEN`];
  return hasClient && hasSecret && hasTokens;
}

/** GET /api/account/list — lista contas e status básico */
router.get('/list', (req, res) => {
  const accounts = Object.entries(ACCOUNTS).map(([key, meta]) => ({
    key,
    label: meta.label,
    configured: accountConfigured(meta.envPrefix)
  }));

  const current = req.cookies?.ml_account || null;
  const currentLabel = current && ACCOUNTS[current] ? ACCOUNTS[current].label : null;

  res.json({ ok: true, accounts, current, currentLabel });
});

/** GET /api/account/current — retorna conta atual */
router.get('/current', (req, res) => {
  const accountKey = req.cookies?.ml_account || null;
  if (!accountKey || !ACCOUNTS[accountKey]) {
    return res.json({ ok: true, accountKey: null, label: null });
  }
  res.json({ ok: true, accountKey, label: ACCOUNTS[accountKey].label });
});

/** POST /api/account/select — define conta (cookie) */
router.post('/select', express.json(), (req, res) => {
  const { accountKey } = req.body || {};
  if (!accountKey || !ACCOUNTS[accountKey]) {
    return res.status(400).json({ ok: false, error: 'accountKey inválido' });
  }
  res.cookie('ml_account', accountKey, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 3600 * 1000 // 30 dias
  });
  res.json({ ok: true, accountKey, label: ACCOUNTS[accountKey].label });
});

/** POST /api/account/clear — limpa seleção */
router.post('/clear', (_req, res) => {
  res.clearCookie('ml_account');
  res.json({ ok: true });
});

module.exports = router;
module.exports.ACCOUNTS = ACCOUNTS;
