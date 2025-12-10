// services/excluirAnuncioService.js
const fetch = require('node-fetch');
const TokenService = require('./tokenService');
const config = require('../config/config');

const urls = {
  items: config?.urls?.items || 'https://api.mercadolibre.com/items',
  me: config?.urls?.users_me || 'https://api.mercadolibre.com/users/me'
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prepara estado de autenticação (reutilizável em lote).
 * Pode futuramente receber opções (conta, tokens etc.).
 */
async function prepararState(options = {}) {
  const creds = {
    app_id: process.env.APP_ID,
    client_secret: process.env.CLIENT_SECRET,
    refresh_token: process.env.REFRESH_TOKEN,
    access_token: process.env.ACCESS_TOKEN,
    ...options,
  };

  const token = await TokenService.renovarTokenSeNecessario(creds);
  return { token, creds };
}

/**
 * Fetch autenticado com retry em caso de 401 (renova token).
 */
async function authFetch(url, init, state) {
  const baseHeaders = init.headers || {};
  const headers = {
    ...baseHeaders,
    Authorization: `Bearer ${state.token}`,
  };

  let resp = await fetch(url, { ...init, headers });
  if (resp.status !== 401) return resp;

  // 401 → tenta renovar token e refazer a requisição
  const novoToken = await TokenService.renovarToken(state.creds);
  state.token = novoToken.access_token;

  const headers2 = {
    ...baseHeaders,
    Authorization: `Bearer ${state.token}`,
  };
  return fetch(url, { ...init, headers: headers2 });
}

class ExclusaoService {
  /**
   * Exclui um único anúncio seguindo a doc do ML:
   *  1) PUT /items/{id} { status: "closed" }
   *  2) PUT /items/{id} { deleted: true }
   */
  static async excluirUnico(mlbId, stateMaybe) {
    const mlb = String(mlbId || '').trim().toUpperCase();

    // Se o caller passou um "state" (caso de lote), reaproveita; senão cria um novo
    const state =
      stateMaybe && stateMaybe.token && stateMaybe.creds
        ? stateMaybe
        : await prepararState();

    const steps = [];
    let statusInicial = null;
    let statusPosFechamento = null;
    let detalhesUltimaResposta = null;

    try {
      const itemUrl = `${urls.items}/${mlb}`;

      // 1) Carregar item
      const rItem = await authFetch(itemUrl, { method: 'GET', headers: {} }, state);
      const itemText = await rItem.text();
      let itemJson = null;
      try {
        itemJson = JSON.parse(itemText);
      } catch {
        // segue sem travar
      }
      detalhesUltimaResposta = itemText;

      if (!rItem.ok) {
        const msgBase = `Item inválido ou não encontrado (HTTP ${rItem.status})`;
        return {
          success: false,
          mlb_id: mlb,
          error: true,
          message: msgBase,
          detalhes_ml: itemText || null,
          steps: [
            ...steps,
            { step: 'item_erro', http_status: rItem.status, body_raw: itemText || null },
          ],
        };
      }

      const item = itemJson || {};
      statusInicial = item.status || null;
      steps.push({
        step: 'item_carregado',
        status: statusInicial,
        seller_id: item.seller_id,
      });

      // 2) Validar owner
      const rMe = await authFetch(urls.me, { method: 'GET', headers: {} }, state);
      const meText = await rMe.text();
      let meJson = null;
      try {
        meJson = JSON.parse(meText);
      } catch {
        // segue
      }
      detalhesUltimaResposta = meText;

      if (!rMe.ok || !meJson || !meJson.id) {
        return {
          success: false,
          mlb_id: mlb,
          error: true,
          message: `Falha ao validar dono do anúncio (HTTP ${rMe.status})`,
          detalhes_ml: meText || null,
          steps: [
            ...steps,
            { step: 'owner_erro', http_status: rMe.status, body_raw: meText || null },
          ],
        };
      }

      steps.push({ step: 'owner_ok', me_id: meJson.id });

      if (item.seller_id !== meJson.id) {
        return {
          success: false,
          mlb_id: mlb,
          error: true,
          message: 'Este anúncio não pertence à sua conta Mercado Livre.',
          status_inicial: statusInicial,
          detalhes_ml: itemText || null,
          steps,
        };
      }

      // 3) Garantir que está closed
      if (statusInicial !== 'closed') {
        const bodyClose = JSON.stringify({ status: 'closed' });
        const rClose = await authFetch(
          itemUrl,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: bodyClose,
          },
          state,
        );

        const closeText = await rClose.text();
        let closeJson = null;
        try {
          closeJson = JSON.parse(closeText);
        } catch {
          // segue
        }
        detalhesUltimaResposta = closeText;

        if (!rClose.ok) {
          return {
            success: false,
            mlb_id: mlb,
            error: true,
            message: `Erro ao fechar anúncio antes de excluir: HTTP ${rClose.status}`,
            status_inicial: statusInicial,
            detalhes_ml: closeText || null,
            steps: [
              ...steps,
              {
                step: 'fechar_erro',
                http_status: rClose.status,
                body_raw: closeText || null,
              },
            ],
          };
        }

        statusPosFechamento = closeJson?.status || 'closed';
        steps.push({
          step: 'fechado_sucesso',
          from: statusInicial,
          to: statusPosFechamento,
        });
      } else {
        statusPosFechamento = statusInicial;
        steps.push({
          step: 'ja_estava_closed',
          status: statusInicial,
        });
      }

      // 4) Excluir de fato → PUT deleted=true
      const bodyDelete = JSON.stringify({ deleted: true });
      const rDel = await authFetch(
        itemUrl,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: bodyDelete,
        },
        state,
      );

      const delText = await rDel.text();
      let delJson = null;
      try {
        delJson = JSON.parse(delText);
      } catch {
        // ok
      }
      detalhesUltimaResposta = delText;

      if (!rDel.ok) {
        // Alguns casos o ML não permite excluir (histórico, teve vendas etc.)
        let msg = `Erro ao excluir anúncio: HTTP ${rDel.status}`;
        if (delJson?.error || delJson?.message) {
          msg += ` — ${delJson.error || delJson.message}`;
        }

        return {
          success: false,
          mlb_id: mlb,
          error: true,
          message: msg,
          status_inicial: statusInicial,
          status_pos_fechamento: statusPosFechamento,
          deletado: false,
          detalhes_ml: delText || null,
          steps: [
            ...steps,
            {
              step: 'exclusao_erro',
              http_status: rDel.status,
              body_raw: delText || null,
            },
          ],
        };
      }

      steps.push({
        step: 'exclusao_sucesso',
        http_status: rDel.status,
        body_raw: delText || null,
      });

      return {
        success: true,
        mlb_id: mlb,
        titulo: item.title || null,
        message: 'Anúncio fechado e excluído com sucesso.',
        status_inicial: statusInicial,
        status_pos_fechamento: statusPosFechamento,
        deletado: true,
        detalhes_ml: delText || null,
        steps,
      };
    } catch (err) {
      return {
        success: false,
        mlb_id: mlb,
        error: true,
        message: `Falha inesperada ao excluir anúncio: ${err.message}`,
        status_inicial: statusInicial,
        status_pos_fechamento: statusPosFechamento,
        detalhes_ml: detalhesUltimaResposta,
        steps: [
          ...steps,
          { step: 'erro_inesperado', error_message: err.message },
        ],
      };
    }
  }

  /**
   * Processa um lote de anúncios, atualizando um objeto de status em memória.
   * Usado pelo fluxo legado de /anuncios/excluir-lote.
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
        (statusRef.processados / mlbIds.length) * 100,
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
