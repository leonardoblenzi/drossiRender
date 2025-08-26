// controllers/AdAnalysisController.js
const AdAnalysisService = require('../services/adAnalysisService');

function getAccountMeta(res) {
  return {
    key: res?.locals?.accountKey || null,
    label: res?.locals?.accountLabel || null
  };
}

// repassa credenciais da conta atual (ensureAccount colocou em res.locals.mlCreds)
function getCreds(res) {
  return res?.locals?.mlCreds || {};
}

class AdAnalysisController {
  static async analisarItem(req, res) {
    try {
      const { mlb } = req.body || {};
      if (!mlb) return res.status(400).json({ success: false, error: 'Informe o MLB.' });

      // passa num objeto com mlCreds e chave da conta (o service usa para renovar token e logs)
      const opts = { mlCreds: getCreds(res), accountKey: res?.locals?.accountKey || 'conta' };
      const result = await AdAnalysisService.analisarUm(String(mlb).trim(), opts);

      return res.json({ ...result, account: getAccountMeta(res) });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao analisar',
        account: getAccountMeta(res)
      });
    }
  }

  static async gerarXlsx(req, res) {
    try {
      const { rows } = req.body || {};
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, error: 'Nenhum dado para exportar.' });
      }

      // Se o service tiver utilitário de XLSX, usa; senão, tenta exceljs; por fim, CSV.
      if (typeof AdAnalysisService.gerarXlsx === 'function') {
        const buffer = await AdAnalysisService.gerarXlsx(rows);
        const fileName = `analise-anuncios-${Date.now()}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(Buffer.from(buffer));
      }

      // tenta exceljs diretamente
      try {
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Análise');

        const cols = Object.keys(rows[0] || {});
        ws.columns = cols.map(key => ({ header: key, key }));

        rows.forEach(r => ws.addRow(r));
        ws.getRow(1).font = { bold: true };

        const buf = await wb.xlsx.writeBuffer();
        const fileName = `analise-anuncios-${Date.now()}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(Buffer.from(buf));
      } catch (e) {
        // fallback CSV
        const cols = Object.keys(rows[0] || {});
        const escape = (v) => {
          if (v === null || v === undefined) return '';
          const s = String(v);
          return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const header = cols.map(escape).join(';');
        const body = rows.map(r => cols.map(c => escape(r[c])).join(';')).join('\n');
        const csv = header + '\n' + body;

        const fileName = `analise-anuncios-${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(csv);
      }
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao gerar arquivo'
      });
    }
  }
}

module.exports = AdAnalysisController;
