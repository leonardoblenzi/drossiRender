// services/excluirAnuncioService.js
const fetch = require('node-fetch');
const TokenService = require('./tokenService');
const config = require('../config/config');

const urls = {
  items: config?.urls?.items || 'https://api.mercadolibre.com/items',
  me: config?.urls?.users_me || 'https://api.mercadolibre.com/users/me',
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function prepararState(options = {}) {
  const creds = {
    app_id: process.env.APP_ID,
    client_secret: process.env.CLIENT_SECRET,
    refresh_token: process.env.REFRESH_TOKEN,
    access_token: process.env.ACCESS_TOKEN,
  };
  const merged = { ...creds, ...options };
  const token = await TokenService.renovarTokenSeNecessario(merged);
  return { token, creds: merged };
}

async function authFetch(url, init, state) {
  const headers = { ...(init.headers || {}), Authorization: `Bearer ${state.token}` };
  let resp = await fetch(url, { ...init, headers });

  // Se não deu 401, retorna direto
  if (resp.status !== 401) return resp;

  // Tentativa de renovar token
  const novoToken = await TokenService.renovarToken(state.creds);
  state.token = novoToken.access_token;

  return fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${state.token}` },
  });
}

class ExclusaoService {
  /**
   * Exclui (ou fecha) um único anúncio.
   * Estratégia:
   *  1. GET /items/:id  => valida item e dono
   *  2. Se status !== 'closed', tenta PUT { status: 'closed' }
   *  3. Tenta DELETE /items/:id
   *     - Se OK          => success: true, mode: 'deleted'
   *     - Se 404/403 etc => success: true, mode: 'closed_only' (fechado mas não deletado)
   */
  static async excluirUnico(mlbId, authState) {
    const state = authState || (await prepararState());

    const steps = [];
    let statusInicial = null;
    let statusFinal = null;
    let statusTentado = null;
    let tentouFechar = false;
    let fechouOk = false;
    let erroFechar = null;

    try {
      const itemUrl = `${urls.items}/${mlbId}`;

      // 1) Carrega item
      const rItem = await authFetch(itemUrl, { method: 'GET', headers: {} }, state);
      if (!rItem.ok) {
        const body = await rItem.text().catch(() => '');
        steps.push({
          step: 'erro_carregar_item',
          http: rItem.status,
          body,
        });
        return {
          success: false,
          mode: 'error',
          mlb_id: mlbId,
          error: true,
          message: `Item inválido ou não encontrado (HTTP ${rItem.status})`,
          status_inicial: null,
          status_final: null,
          detalhes_ml: body || null,
          steps,
        };
      }

      const item = await rItem.json();
      statusInicial = item.status;
      statusFinal = item.status;
      statusTentado = item.status;
      steps.push({
        step: 'item_carregado',
        status: item.status,
        seller_id: item.seller_id,
      });

      // 2) Confirma dono
      const rMe = await authFetch(urls.me, { method: 'GET', headers: {} }, state);
      const me = await rMe.json();
      steps.push({ step: 'owner_ok', me_id: me.id });

      if (item.seller_id !== me.id) {
        return {
          success: false,
          mode: 'error',
          mlb_id: mlbId,
          error: true,
          message: 'Este anúncio não pertence à sua conta',
          status_inicial: statusInicial,
          status_final: statusFinal,
          steps,
        };
      }

      // 3) Se não estiver fechado, tenta fechar
      if (item.status !== 'closed') {
        tentouFechar = true;
        statusTentado = 'closed';

        const rClose = await authFetch(
          itemUrl,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'closed' }),
          },
          state
        );

        if (!rClose.ok) {
          const body = await rClose.text().catch(() => '');
          steps.push({
            step: 'erro_fechar',
            http: rClose.status,
            body,
          });
          erroFechar = `Erro ao fechar anúncio (HTTP ${rClose.status})`;

          // Mesmo assim, continuamos tentando o DELETE, mas statusFinal fica o original
        } else {
          const closedItem = await rClose.json();
          statusFinal = closedItem.status || 'closed';
          fechouOk = statusFinal === 'closed';
          steps.push({
            step: 'fechado_sucesso',
            status: statusFinal,
          });
        }
      } else {
        steps.push({ step: 'ja_fechado', status: item.status });
      }

      // 4) Tenta deletar (só faz sentido quando statusFinal === 'closed')
      let deleteHttp = null;
      let deleteBody = null;
      let deleteOk = false;

      if (statusFinal === 'closed') {
        const rDel = await authFetch(itemUrl, { method: 'DELETE', headers: {} }, state);
        deleteHttp = rDel.status;

        if (rDel.ok) {
          deleteOk = true;
          steps.push({ step: 'delete_ok', http: rDel.status });

          return {
            success: true,
            mode: 'deleted',
            message: 'Anúncio excluído com sucesso.',
            mlb_id: mlbId,
            titulo: item.title,
            status_inicial: statusInicial,
            status_final: 'deleted',
            status_tentado: statusTentado,
            tentativa_fechar: tentouFechar
              ? fechouOk
                ? 'sucesso'
                : 'falha'
              : 'não necessário',
            erro_fechar: erroFechar,
            detalhes_ml: null,
            steps,
          };
        }

        deleteBody = await rDel.text().catch(() => '');
        steps.push({
          step: 'delete_falha',
          http: rDel.status,
          body: deleteBody,
        });
      }

      // 5) Se chegou aqui, NÃO deletou.
      //    Mas se está CLOSED, tratamos como "closed_only" (sucesso parcial).
      const detalhesMl = deleteBody || null;

      // Caso "não apaga mas está fechado" → sucesso parcial
      if (statusFinal === 'closed') {
        const msgBase =
          deleteHttp === 404 || deleteHttp === 403
            ? 'Anúncio foi fechado (inativado), mas o Mercado Livre não permite exclusão definitiva para este caso (já vendeu, está arquivado ou é apenas histórico).'
            : `Anúncio foi fechado (inativado), mas não foi possível excluir definitivamente (HTTP ${deleteHttp || 'desconhecido'}).`;

        return {
          success: true, // ✅ consideramos sucesso, porém só "fechado"
          mode: 'closed_only',
          mlb_id: mlbId,
          titulo: item.title,
          message: msgBase,
          status_inicial: statusInicial,
          status_final: statusFinal,
          status_tentado: statusTentado,
          tentativa_fechar: tentouFechar
            ? fechouOk
              ? 'sucesso'
              : 'falha'
            : 'não necessário',
          erro_fechar: erroFechar,
          soft_closed: true,
          detalhes_ml: detalhesMl,
          steps,
        };
      }

      // 6) Não fechamos nem deletamos → erro real
      return {
        success: false,
        mode: 'error',
        mlb_id: mlbId,
        error: true,
        message:
          erroFechar ||
          'Não foi possível fechar nem excluir o anúncio. Consulte os detalhes em steps.',
        status_inicial: statusInicial,
        status_final: statusFinal,
        status_tentado: statusTentado,
        tentativa_fechar: tentouFechar
          ? fechouOk
            ? 'sucesso'
            : 'falha'
          : 'não necessário',
        erro_fechar: erroFechar,
        detalhes_ml: null,
        steps,
      };
    } catch (err) {
      steps.push({ step: 'unexpected_error', error: err.message });
      return {
        success: false,
        mode: 'error',
        mlb_id: mlbId,
        error: true,
        message: err.message,
        status_inicial: statusInicial,
        status_final: statusFinal,
        status_tentado: statusTentado,
        tentativa_fechar: tentouFechar ? (fechouOk ? 'sucesso' : 'falha') : 'não necessário',
        erro_fechar: erroFechar,
        detalhes_ml: null,
        steps,
      };
    }
  }

  /**
   * Exclusão em lote reaproveitando o mesmo token (state)
   */
  static async excluirLote(mlbIds, processoId, statusRef, delayEntre = 2000) {
    const state = await prepararState();

    statusRef.status = 'processando';

    for (let i = 0; i < mlbIds.length; i++) {
      const id = String(mlbIds[i] || '').trim();
      if (!id) continue;

      const resultado = await this.excluirUnico(id, state);
      statusRef.resultados.push(resultado);

      if (resultado.success) statusRef.sucessos++;
      else statusRef.erros++;

      statusRef.processados++;
      statusRef.progresso = Math.round(
        (statusRef.processados / mlbIds.length) * 100
      );

      if (i < mlbIds.length - 1) {
        await delay(delayEntre);
      }
    }

    statusRef.status = 'concluido';
    statusRef.concluido_em = new Date();
  }
}

module.exports = ExclusaoService;
