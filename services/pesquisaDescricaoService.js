// pesquisaDescricaoService.js

const axios = require('axios');
const cheerio = require('cheerio');

/** =========================
 *  Helpers de normalização
 *  ========================= */
const removeAcentos = (s = '') =>
  String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalizar = (s = '') =>
  removeAcentos(String(s).toLowerCase())
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Romano (i..x) simples -> inteiro
const romanoParaInt = (r) => {
  if (!r) return null;
  const mapa = { i: 1, v: 5, x: 10 };
  const s = String(r).toLowerCase().replace(/[^ivx]/g, '');
  if (!s) return null;
  let total = 0, prev = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const val = mapa[s[i]] || 0;
    total += (val < prev) ? -val : val;
    prev = val;
  }
  return total || null;
};

class PesquisaDescricaoService {
  constructor() {
    this.baseURL = 'https://api.mercadolibre.com';
    this.timeout = 30000;
    this.maxRetries = 3;
    this.retryDelay = 1000;

    // Configuração do axios com headers mais robustos
    this.axiosInstance = axios.create({
      timeout: this.timeout,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    // Interceptador para retry automático
    this.axiosInstance.interceptors.response.use(
      response => response,
      async error => {
        const config = error.config || {};
        if (config.retry == null) config.retry = 0;

        if (config.retry < this.maxRetries && this.shouldRetry(error)) {
          config.retry++;
          console.log(`🔄 Tentativa ${config.retry}/${this.maxRetries} para ${config.url}`);
          await this.delay(this.retryDelay * config.retry);
          return this.axiosInstance(config);
        }
        return Promise.reject(error);
      }
    );

    /** =========================================================
     *  Padrões LOGÍSTICOS para múltiplos volumes/caixas/embalagens
     *  (rodam sobre TEXTO NORMALIZADO)
     *  ========================================================= */
    this.padroesDoisVolumes = [
      // "entregue em: 2 volumes"
      {
        regex:
          /\bentregue\s+em[:\s]*(\d{1,2}|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(volumes?|caixas?|embalagens?)\b/gi,
        descricao: 'Entregue em: N volumes/caixas/embalagens'
      },
      // "enviado/envio/vai em 2 volumes/caixas/embalagens"
      {
        regex:
          /\b(enviado|entrega|envio|vai|segue|remessa|embalado)\s+em\s+(?:\d{1,2}|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(volumes?|caixas?|embalagens?)\b/gi,
        descricao: 'Verbo logístico + em N volumes/caixas/embalagens'
      },
      // Abreviação: "2 vol." / "2 vols."
      {
        regex: /\b(\d{1,2})\s*vols?\.?\b/gi,
        descricao: 'Abreviação de volume (2 vol./vols.)'
      },
      // Genérico: "2 volumes/caixas/embalagens"
      {
        regex:
          /\b(\d{1,2}|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(volumes?|caixas?|embalagens?)\b/gi,
        descricao: 'N volumes/caixas/embalagens (genérico)'
      }
    ];
  }

  shouldRetry(error) {
    return (
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND' ||
      (error.response && error.response.status >= 500) ||
      (error.response && error.response.status === 429)
    );
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async pesquisarTextoEmDescricoes(mlbIds, textoPesquisa) {
    const resultados = [];
    const textoPesquisaLower = textoPesquisa.toLowerCase();
    console.log(`Iniciando pesquisa por "${textoPesquisa}" em ${mlbIds.length} produtos...`);

    for (let i = 0; i < mlbIds.length; i++) {
      const mlb = mlbIds[i];
      console.log(`Processando ${i + 1}/${mlbIds.length}: ${mlb}`);

      try {
        const descricaoCompleta = await this.obterDescricaoProduto(mlb);

        if (!descricaoCompleta) {
          resultados.push({
            mlb,
            encontrado: false,
            titulo: null,
            descricao_encontrada: null,
            trecho_relevante: null,
            erro: 'Não foi possível obter a descrição do produto'
          });
          continue;
        }

        const { titulo, descricao } = descricaoCompleta;
        const descricaoLower = (descricao || '').toLowerCase();
        const encontrado = descricaoLower.includes(textoPesquisaLower);

        let trechoRelevante = null;
        if (encontrado) {
          trechoRelevante = this.extrairTrechoRelevante(descricao, textoPesquisa);
        }

        resultados.push({
          mlb,
          encontrado,
          titulo,
          descricao_encontrada: encontrado ? descricao : null,
          trecho_relevante: trechoRelevante,
          erro: null
        });

      } catch (error) {
        console.error(`Erro ao processar ${mlb}:`, error.message);
        resultados.push({
          mlb,
          encontrado: false,
          titulo: null,
          descricao_encontrada: null,
          trecho_relevante: null,
          erro: error.message
        });
      }

      if (i < mlbIds.length - 1) {
        await this.delay(2000);
      }
    }

    console.log(`Pesquisa concluída. ${resultados.filter(r => r.encontrado).length}/${mlbIds.length} produtos encontrados.`);
    return resultados;
  }

  /**
   * Detecta produtos enviados em mais de 1 volume/caixa/embalagem
   */
  async detectarProdutosDoisVolumes(mlbIds) {
    const resultados = [];

    console.log(`Iniciando detecção de produtos com 2+ volumes em ${mlbIds.length} produtos...`);

    for (let i = 0; i < mlbIds.length; i++) {
      const mlb = mlbIds[i];
      console.log(`Processando ${i + 1}/${mlbIds.length}: ${mlb}`);

      try {
        const descricaoCompleta = await this.obterDescricaoProduto(mlb);

        if (!descricaoCompleta) {
          resultados.push({
            mlb,
            encontrado: false,
            titulo: null,
            descricao_encontrada: null,
            trecho_relevante: null,
            erro: 'Não foi possível obter a descrição do produto',
            deteccao_dois_volumes: {
              detectado: false,
              padrao_detectado: null,
              trecho_detectado: null
            }
          });
          continue;
        }

        const { titulo, descricao } = descricaoCompleta;
        const deteccaoResultado = this.analisarDoisVolumes(titulo, descricao);

        resultados.push({
          mlb,
          encontrado: !!deteccaoResultado.detectado,
          titulo,
          descricao_encontrada: deteccaoResultado.detectado ? descricao : null,
          trecho_relevante: deteccaoResultado.trecho_detectado,
          erro: null,
          deteccao_dois_volumes: deteccaoResultado
        });

      } catch (error) {
        console.error(`Erro ao processar ${mlb}:`, error.message);
        resultados.push({
          mlb,
          encontrado: false,
          titulo: null,
          descricao_encontrada: null,
          trecho_relevante: null,
          erro: error.message,
          deteccao_dois_volumes: {
            detectado: false,
            padrao_detectado: null,
            trecho_detectado: null
          }
        });
      }

      if (i < mlbIds.length - 1) {
        await this.delay(2000);
      }
    }

    const detectados = resultados.filter(r => r.deteccao_dois_volumes.detectado).length;
    console.log(`Detecção concluída. ${detectados}/${mlbIds.length} produtos com 2+ volumes/caixas detectados.`);

    return resultados;
  }

  /**
   * Analisa TÍTULO + DESCRIÇÃO para determinar múltiplos volumes
   */
  analisarDoisVolumes(titulo = '', descricao = '') {
    const tituloNorm = normalizar(titulo);
    const descNorm = normalizar(descricao);
    const textoNorm = `${tituloNorm} ${descNorm}`.trim();

    // (A) Padrões logísticos clássicos ("entregue em: 02 volumes", "enviado em 2 caixas"...)
    for (const padrao of this.padroesDoisVolumes) {
      const match = textoNorm.match(padrao.regex);
      if (match) {
        const trecho =
          this.extrairTrechoRelevante(descricao, 'volum') ||
          this.extrairTrechoRelevante(descricao, 'caixa') ||
          this.extrairTrechoRelevante(descricao, 'embal');

        return {
          detectado: true,
          padrao_detectado: padrao.descricao,
          trecho_detectado: trecho,
          match_original: match[0]
        };
      }
    }

    // (B) Detector abrangente de "mais de 1 volume/caixa" (quantificador, abreviações, enumerações/rótulos)
    const dv = this.detectarMaisDeUmVolume(titulo, descricao);
    if (dv.detectado) {
      return {
        detectado: true,
        padrao_detectado: `Mais de 1 volume/caixa (${dv.causa})`,
        trecho_detectado:
          this.extrairTrechoRelevante(descricao, (dv.evidencias[0] || '').slice(0, 20)) || null,
        match_original: dv.evidencias[0] || 'multi_volume'
      };
    }

    // (C) Regra de negócio: KIT com "base madeira" (não unitário) → bloqueia
    if (this.ehKitBaseMadeira(titulo, descricao)) {
      return {
        detectado: true,
        padrao_detectado: 'Regra: kit com base madeira (não unitário)',
        trecho_detectado: this.extrairTrechoRelevante(descricao, 'base') || null,
        match_original: 'kit_base_madeira'
      };
    }

    return { detectado: false, padrao_detectado: null, trecho_detectado: null };
  }

  /**
   * Detector abrangente de "mais de 1 volume/caixa"
   */
  detectarMaisDeUmVolume(titulo = '', descricao = '') {
    const t = normalizar(titulo);
    const d = normalizar(descricao);
    const texto = `${t} ${d}`;

    // 1) Quantificador explícito >= 2 (02, 2, 03, 3, ...) + volumes/caixas/embalagens/abreviações
    const reQuantificador =
      /\b(0?[2-9]|[1-9]\d)\s*(volumes?|vols?\.?|caixas?|cxs?|embalagens?)\b/i;
    const mQuant = texto.match(reQuantificador);
    if (mQuant) {
      return {
        detectado: true,
        causa: 'quantificador >= 2 (volumes/caixas/embalagens)',
        evidencias: [mQuant[0]]
      };
    }

    // 2) "mais de 1 volume/caixa"
    const reMaisDeUm =
      /\bmais\s+de\s+(?:um|uma|1)\s*(volume|vol\.?|caixa|embalagem|cx(?:s)?)\b/i;
    const mMais = texto.match(reMaisDeUm);
    if (mMais) {
      return {
        detectado: true,
        causa: 'mais de 1 unidade de volume/caixa',
        evidencias: [mMais[0]]
      };
    }

    // 3) Rótulos enumerados -> "volume 1/2", "vol. 01 e 02", "caixa 1-2", "cx 01/02"
    const labels = new Set();

    // volumes arábicos
    const reVolNum = /\bvol(?:umes?|s?\.?)\s*(?:n[ºo]\s*)?(\d{1,2})\b/gi;
    let m;
    while ((m = reVolNum.exec(texto))) labels.add(parseInt(m[1], 10));
    // volumes romanos
    const reVolRom = /\bvol(?:umes?|s?\.?)\s*(?:n[ºo]\s*)?([ivx]{1,4})\b/gi;
    let m2;
    while ((m2 = reVolRom.exec(texto))) {
      const n = romanoParaInt(m2[1]);
      if (n) labels.add(n);
    }
    // caixas arábicas
    const reCxNum = /\b(caixas?|cxs?|cx)\s*(?:n[ºo]\s*)?(\d{1,2})\b/gi;
    let m3;
    while ((m3 = reCxNum.exec(texto))) labels.add(parseInt(m3[2], 10));

    if (labels.size >= 2) {
      return {
        detectado: true,
        causa: 'rotulos enumerados (ex.: volume 1/2, caixa 01/02)',
        evidencias: [`labels=${[...labels].sort((a, b) => a - b).join(',')}`]
      };
    }

    // proximidade: "volume 1 e 2" / "caixa 1-2" / "vol 01/02"
    const reEnumProximo =
      /\b(vol(?:umes?|s?\.?)|caixas?|cxs?|cx)\s*(?:n[ºo]\s*)?(0?\d{1,2}|[ivx]{1,4})\s*(?:e|-|\/|a)\s*(0?\d{1,2}|[ivx]{1,4})\b/gi;
    const mEnum = texto.match(reEnumProximo);
    if (mEnum) {
      return {
        detectado: true,
        causa: 'enumeracao proxima (1 e 2 / 1-2 / 1/2)',
        evidencias: mEnum
      };
    }

    // 4) Abreviações soltas "2 vols.", "2 cxs."
    const reAbrev = /\b(0?[2-9]|[1-9]\d)\s*(vols?\.?|cxs?)\b/gi;
    const mAbrev = texto.match(reAbrev);
    if (mAbrev) {
      return {
        detectado: true,
        causa: 'abreviacao com >=2 (vols./cxs.)',
        evidencias: mAbrev
      };
    }

    return { detectado: false, causa: null, evidencias: [] };
  }

  /**
   * Regra de negócio:
   * KIT + "base madeira" (não unitário) => não apto / tratar como multi-volume
   * Unitário "base madeira" continua apto.
   */
  ehKitBaseMadeira(titulo = '', descricao = '') {
    const t = normalizar(titulo);
    const d = normalizar(descricao);
    const texto = `${t} ${d}`;

    const temBaseMadeira =
      /\b(base\s*(de|em)?\s*madeira|pes\s*(de|em)?\s*madeira)\b/i.test(texto);

    // indícios de kit/dupla/par (não unitário)
    const indiciosMulti = [
      /\bkit\b.*\b(2|02|dois|duas)\b/i,                              // "kit 2"
      /\b(par|dupla|duo)\s+de\b/i,                                   // "par de", "dupla de"
      /\b(2|02|dois|duas)\s*(pecas?|p[çc]s?|unidades?|un\.?|und\.?|itens?|produtos?)\b/i,
      /\b(0?1|1)\s+\w+(?:\s+\w+){0,4}\s+(?:e|&|\+)\s+(0?1|1)\s+\w+/i // "1 poltrona e 1 puff"
    ];
    const ehKitOuPar = indiciosMulti.some(rgx => rgx.test(texto));

    return temBaseMadeira && ehKitOuPar;
  }

  // =======================
  // OBTENÇÃO DE DESCRIÇÃO
  // =======================
  async obterDescricaoProduto(mlb) {
    console.log(`🔍 Obtendo descrição para ${mlb}...`);

    // 1) Scraping da página
    try {
      console.log(`📄 Tentando scraping da página para ${mlb}...`);
      const resultado = await this.extrairDescricaoViaFetch(mlb);
      if (resultado && resultado.descricao && resultado.descricao.trim().length > 50) {
        console.log(`✅ Descrição obtida via scraping para ${mlb}`);
        return resultado;
      }
    } catch (error) {
      console.log(`⚠️ Scraping falhou para ${mlb}: ${error.message}`);
    }

    // 2) API tradicional
    try {
      console.log(`🔌 Tentando API tradicional para ${mlb}...`);
      const resultado = await this.obterDescricaoTradicional(mlb);
      if (resultado && resultado.descricao && resultado.descricao.trim().length > 50) {
        console.log(`✅ Descrição obtida via API para ${mlb}`);
        return resultado;
      }
    } catch (error) {
      console.log(`⚠️ API tradicional falhou para ${mlb}: ${error.message}`);
    }

    // 3) API catálogo
    try {
      console.log(`📚 Tentando API de catálogo para ${mlb}...`);
      const resultado = await this.obterDescricaoCatalogo(mlb);
      if (resultado && resultado.descricao && resultado.descricao.trim().length > 50) {
        console.log(`✅ Descrição obtida via catálogo para ${mlb}`);
        return resultado;
      }
    } catch (error) {
      console.log(`⚠️ API de catálogo falhou para ${mlb}: ${error.message}`);
    }

    console.log(`❌ Todas as estratégias falharam para ${mlb}`);
    return null;
  }

  async obterDescricaoTradicional(mlb) {
    try {
      const itemResponse = await this.axiosInstance.get(`${this.baseURL}/items/${mlb}`);
      const item = itemResponse.data;
      if (!item || item.status === 'closed') {
        throw new Error('Produto não encontrado ou inativo');
      }
      const titulo = item.title || '';

      let descricao = '';
      try {
        const descResponse = await this.axiosInstance.get(`${this.baseURL}/items/${mlb}/description`);
        if (descResponse.data && descResponse.data.plain_text) {
          descricao = descResponse.data.plain_text;
        } else if (descResponse.data && descResponse.data.text) {
          descricao = descResponse.data.text;
        }
      } catch {
        console.log(`Descrição não disponível via API para ${mlb}`);
      }

      if (!descricao || descricao.trim().length < 50) {
        if (item.attributes && Array.isArray(item.attributes)) {
          const atributos = item.attributes
            .filter(attr => attr.value_name && attr.value_name.length > 0)
            .map(attr => `${attr.name}: ${attr.value_name}`)
            .join('. ');
          descricao = `${titulo}. ${atributos}`;
        }
      }

      return { titulo, descricao: descricao || titulo };
    } catch (error) {
      console.error(`Erro na obtenção tradicional para ${mlb}:`, error.message);
      throw error;
    }
  }

  async obterDescricaoCatalogo(mlb) {
    try {
      const itemResponse = await this.axiosInstance.get(`${this.baseURL}/items/${mlb}`);
      const item = itemResponse.data;

      if (!item || !item.catalog_product_id) {
        throw new Error('Produto não possui catalog_product_id');
      }
      const catalogId = item.catalog_product_id;
      const titulo = item.title || '';

      const catalogResponse = await this.axiosInstance.get(`${this.baseURL}/catalog_products/${catalogId}`);
      const catalogData = catalogResponse.data;

      let descricao = '';
      if (catalogData.short_description) descricao += catalogData.short_description + '. ';
      if (catalogData.description) descricao += catalogData.description + '. ';

      if (catalogData.attributes && Array.isArray(catalogData.attributes)) {
        const atributos = catalogData.attributes
          .filter(attr => attr.value_name && attr.value_name.length > 0)
          .map(attr => `${attr.name}: ${attr.value_name}`)
          .join('. ');
        descricao += atributos;
      }

      return { titulo, descricao: descricao || titulo };
    } catch (error) {
      console.error(`Erro na obtenção via catálogo para ${mlb}:`, error.message);
      throw error;
    }
  }

  // URL correta: https://produto.mercadolivre.com.br/MLB-XXXXXXXXXX
  async extrairDescricaoViaFetch(mlb) {
    try {
      const mlbFormatado = mlb.replace('MLB', 'MLB-');
      const url = `https://produto.mercadolivre.com.br/${mlbFormatado}`;
      console.log(`🌐 Fazendo scraping de: ${url}`);

      const response = await this.axiosInstance.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0',
          'Referer': 'https://www.mercadolivre.com.br/'
        }
      });

      const $ = cheerio.load(response.data);

      let titulo = '';
      let descricao = '';

      const seletoresTitulo = [
        'h1.ui-pdp-title',
        '.item-title h1',
        'h1[data-testid="product-title"]',
        '.ui-pdp-title',
        '.ui-pdp-title__text',
        'h1.item-title__primary',
        'h1'
      ];
      for (const seletor of seletoresTitulo) {
        titulo = $(seletor).first().text().trim();
        if (titulo.length > 0) {
          console.log(`📝 Título encontrado com seletor: ${seletor}`);
          break;
        }
      }

      const seletoresDescricao = [
        '.ui-pdp-description__content',
        '.ui-pdp-description .ui-pdp-description__content',
        '.item-description',
        '.ui-pdp-description',
        '[data-testid="description"]',
        '.description-content',
        '.ui-pdp-description__text',
        '.ui-vpp-striped-specs__table',
        '.ui-pdp-specs__table',
        '.ui-pdp-features',
        '.item-description-content',
        '.ui-pdp-description__container'
      ];
      for (const seletor of seletoresDescricao) {
        const elemento = $(seletor);
        if (elemento.length > 0) {
          descricao = elemento.text().trim();
          if (descricao.length > 50) {
            console.log(`📄 Descrição encontrada com seletor: ${seletor} (${descricao.length} chars)`);
            break;
          }
        }
      }

      if (!descricao || descricao.length < 50) {
        console.log(`🔍 Tentando extrair especificações...`);
        const specs = $('.ui-vpp-striped-specs__table tr, .ui-pdp-specs__table tr')
          .map((i, el) => {
            const key = $(el)
              .find('th, .ui-pdp-specs__table__label, .andes-table__header__container')
              .text().trim();
            const value = $(el)
              .find('td, .ui-pdp-specs__table__value, .andes-table__column--value')
              .text().trim();
            return key && value ? `${key}: ${value}` : '';
          })
          .get()
          .filter(spec => spec.length > 0)
          .join('. ');

        if (specs && specs.length > 50) {
          descricao = specs;
          console.log(`📊 Especificações extraídas (${specs.length} chars)`);
        }
      }

      if (!descricao || descricao.length < 50) {
        console.log(`🔍 Tentando extrair atributos...`);
        const atributos = $('.ui-pdp-specs__table tr, .ui-vpp-striped-specs__table tr, .andes-table__row')
          .map((i, el) => {
            const key = $(el)
              .find('.ui-pdp-specs__table__label, th, .andes-table__header')
              .text().trim();
            const value = $(el)
              .find('.ui-pdp-specs__table__value, td, .andes-table__column')
              .text().trim();
            return key && value ? `${key}: ${value}` : '';
          })
          .get()
          .filter(attr => attr.length > 0)
          .join('. ');

        if (atributos && atributos.length > 50) {
          descricao = atributos;
          console.log(`📋 Atributos extraídos (${atributos.length} chars)`);
        }
      }

      if (!descricao || descricao.length < 50) {
        console.log(`🔍 Tentando extrair características...`);
        const caracteristicas = $('.ui-pdp-features, .ui-pdp-highlights, .item-highlights')
          .map((i, el) => $(el).text().trim())
          .get()
          .filter(carac => carac.length > 0)
          .join('. ');

        if (caracteristicas && caracteristicas.length > 50) {
          descricao = caracteristicas;
          console.log(`⭐ Características extraídas (${caracteristicas.length} chars)`);
        }
      }

      if (!descricao || descricao.length < 20) {
        descricao = titulo;
        console.log(`📝 Usando título como descrição`);
      }

      console.log(`📄 Scraping concluído para ${mlb}:`);
      console.log(`   📝 Título: "${titulo.substring(0, 50)}${titulo.length > 50 ? '...' : ''}"`);
      console.log(`   📄 Descrição: ${descricao.length} caracteres`);

      return { titulo, descricao: descricao || titulo };
    } catch (error) {
      console.error(`❌ Erro no scraping para ${mlb}:`, error.message);
      if (error.response) {
        console.error(`   📊 Status: ${error.response.status}`);
        console.error(`   📋 Status Text: ${error.response.statusText}`);
      }
      throw error;
    }
  }

  extrairTrechoRelevante(texto, termoPesquisa, tamanhoContexto = 100) {
    try {
      if (!texto || !termoPesquisa) return null;
      const textoLower = texto.toLowerCase();
      const termoLower = termoPesquisa.toLowerCase();

      const indice = textoLower.indexOf(termoLower);
      if (indice === -1) return null;

      const inicio = Math.max(0, indice - tamanhoContexto);
      const fim = Math.min(texto.length, indice + termoPesquisa.length + tamanhoContexto);

      let trecho = texto.substring(inicio, fim);

      if (inicio > 0) trecho = '...' + trecho;
      if (fim < texto.length) trecho = trecho + '...';

      return trecho.trim();
    } catch (error) {
      console.error('Erro ao extrair trecho relevante:', error);
      return null;
    }
  }

  // ================
  // OUTRAS FUNÇÕES
  // ================
  async obterInformacoesProduto(mlb) {
    try {
      const response = await this.axiosInstance.get(`${this.baseURL}/items/${mlb}`);
      return response.data;
    } catch (error) {
      console.error(`Erro ao obter informações do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async obterDescricaoItem(mlb) {
    try {
      const response = await this.axiosInstance.get(`${this.baseURL}/items/${mlb}/description`);
      return response.data;
    } catch (error) {
      console.error(`Erro ao obter descrição do item ${mlb}:`, error.message);
      throw error;
    }
  }

  async obterAtributosProduto(mlb) {
    try {
      const item = await this.obterInformacoesProduto(mlb);
      return item.attributes || [];
    } catch (error) {
      console.error(`Erro ao obter atributos do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async verificarStatusProduto(mlb) {
    try {
      const item = await this.obterInformacoesProduto(mlb);
      return {
        status: item.status,
        ativo: item.status === 'active',
        titulo: item.title,
        preco: item.price,
        moeda: item.currency_id,
        vendedor_id: item.seller_id,
        categoria_id: item.category_id
      };
    } catch (error) {
      console.error(`Erro ao verificar status do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async obterCategoriaProduto(mlb) {
    try {
      const item = await this.obterInformacoesProduto(mlb);
      if (!item.category_id) return null;

      const categoriaResponse = await this.axiosInstance.get(`${this.baseURL}/categories/${item.category_id}`);
      return categoriaResponse.data;
    } catch (error) {
      console.error(`Erro ao obter categoria do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async pesquisarProdutosPorVendedor(vendedorId, limite = 50) {
    try {
      const response = await this.axiosInstance.get(`${this.baseURL}/sites/MLB/search`, {
        params: { seller_id: vendedorId, limit: limite }
      });
      return response.data.results || [];
    } catch (error) {
      console.error(`Erro ao pesquisar produtos do vendedor ${vendedorId}:`, error.message);
      throw error;
    }
  }

  async obterImagensProduto(mlb) {
    try {
      const item = await this.obterInformacoesProduto(mlb);
      return item.pictures || [];
    } catch (error) {
      console.error(`Erro ao obter imagens do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async obterVariacoesProduto(mlb) {
    try {
      const item = await this.obterInformacoesProduto(mlb);
      if (!item.variations || item.variations.length === 0) return [];

      const variacoes = [];
      for (const variacao of item.variations) {
        try {
          const variacaoDetalhada = await this.axiosInstance.get(`${this.baseURL}/items/${variacao.id}`);
          variacoes.push(variacaoDetalhada.data);
        } catch (varError) {
          console.error(`Erro ao obter variação ${variacao.id}:`, varError.message);
        }
      }
      return variacoes;
    } catch (error) {
      console.error(`Erro ao obter variações do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async obterHistoricoPrecos(mlb) {
    try {
      const item = await this.obterInformacoesProduto(mlb);
      return {
        preco_atual: item.price,
        moeda: item.currency_id,
        data_consulta: new Date().toISOString(),
        historico: []
      };
    } catch (error) {
      console.error(`Erro ao obter histórico de preços do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async analisarConcorrencia(mlb, limite = 20) {
    try {
      const item = await this.obterInformacoesProduto(mlb);
      const categoria = item.category_id;

      const response = await this.axiosInstance.get(`${this.baseURL}/sites/MLB/search`, {
        params: { category: categoria, limit: limite, sort: 'relevance' }
      });

      const produtosSimilares = (response.data.results || []).filter(p => p.id !== mlb);

      return {
        produto_analisado: {
          mlb,
          titulo: item.title,
          preco: item.price,
          categoria
        },
        concorrentes: produtosSimilares.map(produto => ({
          mlb: produto.id,
          titulo: produto.title,
          preco: produto.price,
          vendedor_id: produto.seller.id,
          link: produto.permalink
        })),
        total_encontrados: produtosSimilares.length
      };
    } catch (error) {
      console.error(`Erro ao analisar concorrência do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async obterAvaliacoesProduto(mlb) {
    try {
      const response = await this.axiosInstance.get(`${this.baseURL}/reviews/item/${mlb}`);
      return response.data;
    } catch (error) {
      console.error(`Erro ao obter avaliações do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async obterPerguntasProduto(mlb, limite = 50) {
    try {
      const response = await this.axiosInstance.get(`${this.baseURL}/questions/search`, {
        params: { item_id: mlb, limit: limite, sort_fields: 'date_created', sort_types: 'DESC' }
      });
      return response.data.questions || [];
    } catch (error) {
      console.error(`Erro ao obter perguntas do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async verificarEstoqueProduto(mlb) {
    try {
      const item = await this.obterInformacoesProduto(mlb);
      return {
        disponivel: item.available_quantity > 0,
        quantidade: item.available_quantity,
        vendas: item.sold_quantity || 0,
        status: item.status
      };
    } catch (error) {
      console.error(`Erro ao verificar estoque do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async obterDimensoesProduto(mlb) {
    try {
      const item = await this.obterInformacoesProduto(mlb);

      const atributos = item.attributes || [];
      const dimensoes = {};

      atributos.forEach(attr => {
        const nomeAttr = (attr.id || '').toLowerCase();
        if (nomeAttr.includes('height') || nomeAttr.includes('altura')) {
          dimensoes.altura = { valor: attr.value_name, unidade: attr.value_struct?.unit || 'cm' };
        }
        if (nomeAttr.includes('width') || nomeAttr.includes('largura')) {
          dimensoes.largura = { valor: attr.value_name, unidade: attr.value_struct?.unit || 'cm' };
        }
        if (nomeAttr.includes('length') || nomeAttr.includes('comprimento')) {
          dimensoes.comprimento = { valor: attr.value_name, unidade: attr.value_struct?.unit || 'cm' };
        }
        if (nomeAttr.includes('weight') || nomeAttr.includes('peso')) {
          dimensoes.peso = { valor: attr.value_name, unidade: attr.value_struct?.unit || 'g' };
        }
      });

      if (item.shipping && item.shipping.dimensions) {
        const shippingDims = item.shipping.dimensions;
        if (!dimensoes.altura && shippingDims.height) {
          dimensoes.altura = { valor: shippingDims.height, unidade: 'cm' };
        }
        if (!dimensoes.largura && shippingDims.width) {
          dimensoes.largura = { valor: shippingDims.width, unidade: 'cm' };
        }
        if (!dimensoes.comprimento && shippingDims.length) {
          dimensoes.comprimento = { valor: shippingDims.length, unidade: 'cm' };
        }
      }

      return dimensoes;
    } catch (error) {
      console.error(`Erro ao obter dimensões do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async obterInformacoesEnvio(mlb) {
    try {
      const item = await this.obterInformacoesProduto(mlb);

      return {
        frete_gratis: item.shipping?.free_shipping || false,
        modo_envio: item.shipping?.mode || 'not_specified',
        metodos_envio: item.shipping?.methods || [],
        tags_envio: item.shipping?.tags || [],
        dimensoes: item.shipping?.dimensions || null,
        peso: item.shipping?.weight || null,
        origem: {
          cidade: item.seller_address?.city?.name || null,
          estado: item.seller_address?.state?.name || null,
          pais: item.seller_address?.country?.name || null
        }
      };
    } catch (error) {
      console.error(`Erro ao obter informações de envio do produto ${mlb}:`, error.message);
      throw error;
    }
  }

  async processarLoteMLBs(mlbs, funcaoProcessamento, opcoes = {}) {
    const {
      tamanhoLote = 5,
      delayEntreLotes = 3000,
      delayEntreItens = 1000,
      mostrarProgresso = true
    } = opcoes;

    const resultados = [];
    const totalItens = mlbs.length;
    let processados = 0;

    for (let i = 0; i < mlbs.length; i += tamanhoLote) {
      const lote = mlbs.slice(i, i + tamanhoLote);

      if (mostrarProgresso) {
        console.log(`Processando lote ${Math.floor(i / tamanhoLote) + 1}/${Math.ceil(mlbs.length / tamanhoLote)}`);
      }

      const promessasLote = lote.map(async (mlb, index) => {
        try {
          if (index > 0) await this.delay(delayEntreItens);

          const resultado = await funcaoProcessamento(mlb);
          processados++;

          if (mostrarProgresso) {
            console.log(
              `Progresso: ${processados}/${totalItens} (${((processados / totalItens) * 100).toFixed(1)}%)`
            );
          }

          return resultado;
        } catch (error) {
          processados++;
          console.error(`Erro ao processar ${mlb}:`, error.message);
          return { mlb, erro: error.message, sucesso: false };
        }
      });

      const resultadosLote = await Promise.all(promessasLote);
      resultados.push(...resultadosLote);

      if (i + tamanhoLote < mlbs.length) {
        await this.delay(delayEntreLotes);
      }
    }

    return resultados;
  }

  async gerarRelatorioCompleto(mlbs) {
    const relatorio = {
      data_geracao: new Date().toISOString(),
      total_produtos: mlbs.length,
      produtos: [],
      resumo: {
        ativos: 0,
        inativos: 0,
        com_estoque: 0,
        sem_estoque: 0,
        com_frete_gratis: 0,
        erros: 0
      }
    };

    const processarProduto = async (mlb) => {
      try {
        const [item, descricao, estoque, envio] = await Promise.all([
          this.obterInformacoesProduto(mlb).catch(() => null),
          this.obterDescricaoProduto(mlb).catch(() => null),
          this.verificarEstoqueProduto(mlb).catch(() => null),
          this.obterInformacoesEnvio(mlb).catch(() => null)
        ]);

        const produtoInfo = {
          mlb,
          titulo: item?.title || 'N/A',
          preco: item?.price || 0,
          moeda: item?.currency_id || 'BRL',
          status: item?.status || 'unknown',
          categoria_id: item?.category_id || null,
          vendedor_id: item?.seller_id || null,
          descricao_disponivel: !!descricao,
          estoque: estoque?.quantidade || 0,
          vendas: item?.sold_quantity || 0,
          frete_gratis: envio?.frete_gratis || false,
          data_processamento: new Date().toISOString()
        };

        if (item?.status === 'active') relatorio.resumo.ativos++;
        else relatorio.resumo.inativos++;

        if (estoque?.disponivel) relatorio.resumo.com_estoque++;
        else relatorio.resumo.sem_estoque++;

        if (envio?.frete_gratis) relatorio.resumo.com_frete_gratis++;

        return produtoInfo;
      } catch (error) {
        relatorio.resumo.erros++;
        return { mlb, erro: error.message, data_processamento: new Date().toISOString() };
      }
    };

    relatorio.produtos = await this.processarLoteMLBs(mlbs, processarProduto, {
      tamanhoLote: 3,
      delayEntreLotes: 5000,
      delayEntreItens: 2000,
      mostrarProgresso: true
    });

    return relatorio;
  }

  validarMLBs(mlbs) {
    const mlbsValidos = [];
    const mlbsInvalidos = [];

    mlbs.forEach(mlb => {
      const mlbLimpo = mlb.trim().toUpperCase();
      if (/^MLB\d{10,}$/.test(mlbLimpo)) mlbsValidos.push(mlbLimpo);
      else mlbsInvalidos.push(mlb);
    });

    return {
      validos: mlbsValidos,
      invalidos: mlbsInvalidos,
      total_validos: mlbsValidos.length,
      total_invalidos: mlbsInvalidos.length
    };
  }

  obterEstatisticasUso() {
    return {
      timeout_configurado: this.timeout,
      max_retries: this.maxRetries,
      retry_delay: this.retryDelay,
      base_url: this.baseURL,
      total_padroes_dois_volumes: this.padroesDoisVolumes.length,
      melhorias_aplicadas: [
        'Headers mais robustos para contornar bloqueios',
        'Priorização do scraping da página sobre API',
        'Delay aumentado entre requisições (2s)',
        'Retry automático com backoff exponencial',
        'Múltiplos seletores para extração de dados',
        'Fallback inteligente entre estratégias',
        'Rate limiting configurado para evitar 403/429',
        'Detecção robusta de multi-volumes (inclui abreviações e enumerações)',
        'Regra de negócio: kit + base madeira (não unitário) bloqueado',
        'Análise título + descrição com normalização de texto'
      ]
    };
  }
}

module.exports = new PesquisaDescricaoService();
