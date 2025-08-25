// controllers/CriarPromocaoController.js
const path = require('path');
const TokenService = require('../services/tokenService');
const CriarPromocaoService = require('../services/criarPromocaoService');

// Registro simples de jobs em memória
const jobs = new Map();

function newJobId() {
  return Math.random().toString(36).slice(2, 10);
}

class CriarPromocaoController {
  // POST /api/criar-promocao/desconto/unico
  static async descontoUnico(req, res) {
    try {
      const { mlb, percent } = req.body || {};
      if (!mlb || !percent || Number(percent) <= 0) {
        return res.status(400).json({ success: false, error: 'Parâmetros inválidos. Informe mlb e percent > 0.' });
      }

      // Passa as credenciais da conta atual (ensureAccount) para o service
      const options = {
        mlCreds: res.locals?.mlCreds || {},
        accountKey: res.locals?.accountKey,
        logger: console,
      };

      const result = await CriarPromocaoService.aplicarDescontoUnico(mlb.trim(), Number(percent), options);
      if (result.success) return res.json(result);
      return res.status(400).json(result);
    } catch (err) {
      console.error('❌ [descontoUnico] Erro:', err?.message || err);
      return res.status(500).json({ success: false, error: err?.message || 'Erro interno' });
    }
  }

  // POST /api/criar-promocao/desconto/lote
  static async descontoLote(req, res) {
    try {
      const { mlbs, percent, delay_ms } = req.body || {};
      if (!mlbs || !percent || Number(percent) <= 0) {
        return res.status(400).json({ success: false, error: 'Parâmetros inválidos. Informe mlbs (texto) e percent > 0.' });
      }
      const list = String(mlbs)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);

      if (list.length === 0) {
        return res.status(400).json({ success: false, error: 'Nenhum MLB válido encontrado.' });
      }

      const jobId = newJobId();
      const state = {
        id: jobId,
        status: 'processando',
        criado_em: new Date().toISOString(),
        total: list.length,
        processados: 0,
        ok: 0,
        fail: 0,
        progresso_percentual: 0,
        results: [],
        accountKey: res.locals?.accountKey || 'sem-conta',
      };
      jobs.set(jobId, state);

      // Inicia processamento assíncrono
      setImmediate(async () => {
        try {
          const options = {
            mlCreds: res.locals?.mlCreds || {},
            accountKey: res.locals?.accountKey,
            logger: console,
          };
          for (let i = 0; i < list.length; i++) {
            const id = list[i];
            try {
              const out = await CriarPromocaoService.aplicarDescontoUnico(id, Number(percent), options);
              state.results.push(out);
              if (out.success) state.ok += 1; else state.fail += 1;
            } catch (e) {
              state.fail += 1;
              state.results.push({ success: false, mlb_id: id, error: e?.message || String(e) });
            }
            state.processados = i + 1;
            state.progresso_percentual = Math.round((state.processados / state.total) * 100);
            if (delay_ms && i < list.length - 1) {
              await new Promise(r => setTimeout(r, Number(delay_ms) || 0));
            }
          }
          state.status = 'concluido';
          state.concluido_em = new Date().toISOString();
        } catch (err) {
          state.status = 'erro';
          state.error = err?.message || String(err);
          state.concluido_em = new Date().toISOString();
        }
      });

      return res.json({ success: true, job_id: jobId, total: state.total });
    } catch (err) {
      console.error('❌ [descontoLote] Erro:', err?.message || err);
      return res.status(500).json({ success: false, error: err?.message || 'Erro interno' });
    }
  }

  // GET /api/criar-promocao/status/:jobId
  static async status(req, res) {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job não encontrado.' });
    return res.json({ success: true, ...job });
  }

  // GET /api/criar-promocao/download/:jobId
  static async download(req, res) {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job não encontrado.' });
    const rows = [['mlb_id','applied_percent','base_price','deal_price','success','message']];
    for (const r of job.results || []) {
      rows.push([
        r.mlb_id || '',
        r.applied_percent ?? '',
        r.base_price ?? '',
        r.deal_price ?? '',
        r.success ? 'TRUE' : 'FALSE',
        (r.message || r.error || '').toString().replace(/\n/g,' ')
      ]);
    }
    // CSV simples (Excel-friendly)
    const csv = rows.map(cols => cols.map(v => {
      const s = (v==null?'':String(v));
      if (s.includes(';') || s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g,'""') + '"';
      }
      return s;
    }).join(',')).join('\n');

    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="descontos_${job.id}.csv"`);
    return res.status(200).send('\ufeff' + csv); // BOM para Excel PT-BR
  }
}

module.exports = CriarPromocaoController;
