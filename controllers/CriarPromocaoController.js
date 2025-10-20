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
  // 🛑 MÉTODO PARA LIMPAR TODOS OS JOBS EM MEMÓRIA (EMERGÊNCIA)
  static clearAllJobs() {
    const count = jobs.size;
    jobs.clear();
    console.log(`✅ ${count} jobs removidos da memória`);
    return { success: true, cleared: count };
  }

  // 🔍 MÉTODO PARA LISTAR JOBS (DEBUG)
  static debugJobs() {
    const list = [];
    for (const [id, job] of jobs.entries()) {
      list.push({
        id,
        status: job.status,
        total: job.total,
        processados: job.processados,
        criado_em: job.criado_em,
        concluido_em: job.concluido_em || null
      });
    }
    console.log('🔍 Jobs em memória:', list);
    return list;
  }

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

  // ✅ POST /api/criar-promocao/desconto/lote (CORRIGIDO COM VALIDAÇÃO E CANCELAMENTO)
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

      // ✅ VALIDAÇÃO MELHORADA - IMPEDE CRIAÇÃO DE JOB VAZIO
      if (list.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Nenhum MLB válido encontrado na lista fornecida.',
          count: 0
        });
      }

      // ✅ SÓ CRIAR JOB SE HOUVER ITENS VÁLIDOS
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

      // ✅ PROCESSAMENTO ASSÍNCRONO COM VERIFICAÇÃO DE CANCELAMENTO
      setImmediate(async () => {
        try {
          const options = {
            mlCreds: res.locals?.mlCreds || {},
            accountKey: res.locals?.accountKey,
            logger: console,
          };
          
          for (let i = 0; i < list.length; i++) {
            // ✅ VERIFICAR SE JOB FOI CANCELADO A CADA ITERAÇÃO
            const currentState = jobs.get(jobId);
            if (!currentState || currentState.status === 'cancelado') {
              console.log(`Job ${jobId} foi cancelado, parando processamento no item ${i + 1}/${list.length}`);
              break; // Sai do loop se cancelado
            }
            
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
          
          // ✅ FINALIZAR APENAS SE NÃO FOI CANCELADO
          const finalState = jobs.get(jobId);
          if (finalState && finalState.status !== 'cancelado') {
            finalState.status = 'concluido';
            finalState.concluido_em = new Date().toISOString();
          } else if (finalState && finalState.status === 'cancelado') {
            // Se foi cancelado, apenas garante que tem data de conclusão
            finalState.concluido_em = finalState.concluido_em || new Date().toISOString();
          }
        } catch (err) {
          const errorState = jobs.get(jobId);
          if (errorState && errorState.status !== 'cancelado') {
            errorState.status = 'erro';
            errorState.error = err?.message || String(err);
            errorState.concluido_em = new Date().toISOString();
          }
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

  // ✅ MÉTODO PARA LISTAR TODOS OS JOBS (CORRIGIDO COM LIMPEZA AUTOMÁTICA)
  static getAllJobs() {
    const jobList = [];
    const now = Date.now();
    const HOUR_24 = 24 * 60 * 60 * 1000; // 24 horas
    const HOUR_1 = 60 * 60 * 1000; // 1 hora
    
    // ✅ LIMPEZA AUTOMÁTICA DE JOBS ANTIGOS
    for (const [id, job] of jobs.entries()) {
      const created = new Date(job.criado_em).getTime();
      
      // ✅ REMOVER JOBS MUITO ANTIGOS (mais de 24h)
      if (now - created > HOUR_24) {
        console.log(`🧹 Removendo job antigo (24h+): ${id}`);
        jobs.delete(id);
        continue;
      }
      
      // ✅ REMOVER JOBS CONCLUÍDOS HÁ MAIS DE 1 HORA
      if (['concluido', 'erro', 'cancelado'].includes(job.status) && job.concluido_em) {
        const finished = new Date(job.concluido_em).getTime();
        if (now - finished > HOUR_1) {
          console.log(`🧹 Removendo job concluído antigo (1h+): ${id}`);
          jobs.delete(id);
          continue;
        }
      }
      
      // ✅ ADICIONAR APENAS JOBS VÁLIDOS À LISTA
      jobList.push({
        id: id,
        state: job.status === 'processando' ? 'active' : 
               job.status === 'concluido' ? 'completed' : 
               job.status === 'erro' ? 'failed' :
               job.status === 'cancelado' ? 'cancelled' : job.status,
        label: `Aplicando desconto em lote (${job.processados}/${job.total})`,
        progress: job.progresso_percentual || 0,
        accountKey: job.accountKey,
        created_at: job.criado_em,
        completed_at: job.concluido_em || null,
        total: job.total,
        processados: job.processados,
        ok: job.ok,
        fail: job.fail
      });
    }
    
    // ✅ LOG CONTROLADO (só loga se houver mudança significativa)
    const activeJobs = jobList.filter(j => j.state === 'active').length;
    if (activeJobs > 0 || jobList.length !== this._lastJobCount) {
      console.log(`📋 [CriarPromocaoController] Retornando ${jobList.length} jobs (${activeJobs} ativos)`);
      this._lastJobCount = jobList.length;
    }
    
    return jobList;
  }

  // ✅ MÉTODO PARA CANCELAR JOB (usado pelo PromocoesController)
  static cancelJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) {
      return { success: false, error: 'Job não encontrado' };
    }
    
    // Só permite cancelar se estiver processando
    if (job.status === 'processando') {
      job.status = 'cancelado';
      job.concluido_em = new Date().toISOString();
      console.log(`✅ Job ${jobId} foi cancelado manualmente`);
      return { success: true, message: 'Job cancelado com sucesso' };
    } else {
      return { 
        success: false, 
        error: `Job ${jobId} não pode ser cancelado pois está no status: ${job.status}` 
      };
    }
  }

  // ✅ MÉTODO PARA LIMPAR JOBS CONCLUÍDOS (melhorado)
  static clearCompletedJobs() {
    let cleared = 0;
    const now = Date.now();
    const MINUTE_5 = 5 * 60 * 1000; // 5 minutos
    
    for (const [id, job] of jobs.entries()) {
      // Remove jobs concluídos há mais de 5 minutos
      if (['concluido', 'erro', 'cancelado'].includes(job.status)) {
        const finished = job.concluido_em ? new Date(job.concluido_em).getTime() : now;
        if (now - finished > MINUTE_5) {
          jobs.delete(id);
          cleared++;
        }
      }
    }
    
    if (cleared > 0) {
      console.log(`✅ ${cleared} jobs concluídos foram removidos da memória`);
    }
    
    return { success: true, cleared };
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

// ✅ PROPRIEDADE ESTÁTICA PARA CONTROLE DE LOG
CriarPromocaoController._lastJobCount = 0;

module.exports = CriarPromocaoController;