// services/adAnalysisService.js
const fetch = require('node-fetch');
const ExcelJS = require('exceljs');
const TokenService = require('./tokenService');
const config = require('../config/config');

/** Mapear listing_type_id para texto amigável */
function mapListingType(id) {
  const v = String(id || '').toLowerCase();
  if (v === 'gold_pro') return 'Premium';
  if (v === 'gold_special' || v === 'gold') return 'Clássico';
  // fallback
  return id || 'desconhecido';
}

/** Diferença humana entre agora e uma data ISO */
function timeSince(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const ms = Date.now() - d.getTime();
  if (ms < 0) return '0s';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hrs = Math.floor(min / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `${days}d ${hrs % 24}h`;
  if (hrs > 0) return `${hrs}h ${min % 60}m`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

/** Datas em DD/MM/YYYY HH:mm */
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function urls() {
  return {
    users_me: config?.urls?.users_me || 'https://api.mercadolibre.com/users/me',
    items:    config?.urls?.items    || 'https://api.mercadolibre.com/items'
  };
}

async function authFetch(url, init, token) {
  const headers = { ...(init?.headers || {}), Authorization: `Bearer ${token}` };
  return fetch(url, { ...init, headers });
}

class AdAnalysisService {
  /**
   * Analisa um único MLB (somente da conta selecionada)
   * Retorna { success, mlb, ultima_venda, tipo, tempo_desde_ultima_venda, erro? }
   */
  static async analisarUm(mlbId, mlCredsOrLocals = {}) {
    const U = urls();

    // Garante token válido para a conta atual
    const token = await TokenService.renovarTokenSeNecessario(mlCredsOrLocals);

    // Busca item
    const rItem = await authFetch(`${U.items}/${mlbId}`, { method: 'GET' }, token);
    if (rItem.status === 404) {
      return { success: false, mlb: mlbId, erro: 'MLB não encontrado' };
    }
    if (!rItem.ok) {
      const t = await rItem.text().catch(() => '');
      return { success: false, mlb: mlbId, erro: `Falha em /items (${rItem.status}) ${t}` };
    }
    const item = await rItem.json();

    // Verifica conta (somente itens da conta selecionada)
    const rMe = await authFetch(U.users_me, { method: 'GET' }, token);
    if (!rMe.ok) {
      return { success: false, mlb: mlbId, erro: `Falha em /users/me (${rMe.status})` };
    }
    const me = await rMe.json();
    if (item.seller_id !== me.id) {
      return { success: false, mlb: mlbId, erro: 'Item não pertence à conta selecionada' };
    }

    // Campos pedidos: date_created como "última venda", tipo de anúncio e tempo desde
    const ultimaVendaIso = item.date_created || null; // conforme sua orientação
    const tipo = mapListingType(item.listing_type_id);
    const tempo = timeSince(ultimaVendaIso);

    return {
      success: true,
      mlb: item.id,
      ultima_venda_iso: ultimaVendaIso,
      ultima_venda: fmtDate(ultimaVendaIso),
      tipo,
      tempo_desde_ultima_venda: tempo
    };
  }

  /**
   * Gera um XLSX em memória e devolve Buffer
   * rows: [{ mlb, ultima_venda, tipo, tempo_desde_ultima_venda }]
   */
  static async gerarXlsx(rows = []) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Análise de Anúncios');

    ws.columns = [
      { header: 'MLB', key: 'mlb', width: 20 },
      { header: 'Última venda', key: 'ultima_venda', width: 22 },
      { header: 'Tipo do anúncio', key: 'tipo', width: 18 },
      { header: 'Tempo desde a última venda', key: 'tempo', width: 28 }
    ];

    rows.forEach(r => {
      ws.addRow({
        mlb: r.mlb || '—',
        ultima_venda: r.ultima_venda || '—',
        tipo: r.tipo || '—',
        tempo: r.tempo_desde_ultima_venda || '—'
      });
    });

    // Cabeçalho em negrito
    ws.getRow(1).font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();
    return buffer;
  }
}

module.exports = AdAnalysisService;
