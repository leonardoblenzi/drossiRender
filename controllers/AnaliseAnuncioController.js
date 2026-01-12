// controllers/AnaliseAnuncioController.js
"use strict";

const analiseAnuncioService = require("../services/analiseAnuncioService");

// ✅ Gemini (Google GenAI SDK) — Structured Output do jeito certo (responseSchema + Type)
const { GoogleGenAI, Type } = require("@google/genai");

// Zod para validar o JSON final (ótimo pra garantir formato)
const { z } = require("zod");

// ============================================================================
// Helpers
// ============================================================================

function pickAccessToken(req) {
  // authMiddleware do seu projeto injeta req.ml.accessToken
  const t = req?.ml?.accessToken;
  if (!t) {
    const err = new Error(
      "Token ML ausente em req.ml.accessToken (authMiddleware não injetou)."
    );
    err.statusCode = 401;
    throw err;
  }
  return t;
}

function normMlb(v) {
  const s = String(v || "")
    .trim()
    .toUpperCase();
  if (!/^MLB\d+$/.test(s)) return null;
  return s;
}

function clampDays(v) {
  return Math.max(1, Math.min(365, Number(v || 30)));
}

function normZip(v) {
  const s = String(v || "").trim();
  return s || null;
}

// ============================================================================
// Cache simples em memória (zero custo)
// Obs: reiniciar o Render zera. Para persistente, depois dá pra trocar por Redis/DB.
// ============================================================================

const _cache = new Map();

function cacheGet(key) {
  const it = _cache.get(key);
  if (!it) return null;
  if (it.expiresAt && it.expiresAt < Date.now()) {
    _cache.delete(key);
    return null;
  }
  return it.value;
}

function cacheSet(key, value, ttlSec) {
  const ttl = Number(ttlSec || 0);
  const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;
  _cache.set(key, { value, expiresAt });
}

function cacheKeyFor({ mlb, days, zip_code, model, promptVersion }) {
  return [
    "insights",
    mlb,
    String(days),
    zip_code || "",
    model || "",
    promptVersion || "v1",
  ].join(":");
}

// ============================================================================
// Gemini config
// ============================================================================

let _ai = null;

function getGeminiClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    const err = new Error("GEMINI_API_KEY não configurada no ambiente.");
    err.statusCode = 500;
    throw err;
  }
  if (!_ai) _ai = new GoogleGenAI({ apiKey: key });
  return _ai;
}

function getGeminiModel() {
  // Sugestão: pra testar primeiro, usa gemini-2.5-flash
  return process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
}

function isInsightsEnabled() {
  return String(process.env.IA_INSIGHTS_ENABLED || "0") === "1";
}

function getCacheTtlSec() {
  return Number(process.env.IA_INSIGHTS_CACHE_TTL_SEC || 86400);
}

// ============================================================================
// Analysis pack (enxuto) — NÃO mande raw gigante pro LLM
// ============================================================================

function buildAnalysisPack(data) {
  const { summary, visits, shipping, seller, seller_reputation } = data || {};

  return {
    summary: {
      id: summary?.id ?? null,
      title: summary?.title ?? null,
      status: summary?.status ?? null,
      permalink: summary?.permalink ?? null,
      category_id: summary?.category_id ?? null,
      condition: summary?.condition ?? null,
      currency_id: summary?.currency_id ?? null,
      price: summary?.price ?? null,
      available_quantity: summary?.available_quantity ?? null,
      sold_quantity: summary?.sold_quantity ?? null,
      listing_type_id: summary?.listing_type_id ?? null,
      catalog_listing: summary?.catalog_listing ?? null,
      is_premium: summary?.is_premium ?? null,
      date_created: summary?.date_created ?? null,
      last_updated: summary?.last_updated ?? null,
      sku: summary?.sku ?? null,
    },
    visits: {
      total: visits?.total ?? null,
      date_from: visits?.date_from ?? null,
      date_to: visits?.date_to ?? null,
    },
    shipping: shipping
      ? {
          zip_code: shipping.zip_code ?? null,
          free_shipping: shipping.free_shipping ?? null,
          cost: shipping.cost ?? null,
          logistic_type: shipping.logistic_type ?? null,
          mode: shipping.mode ?? null,
        }
      : null,
    seller: seller
      ? {
          seller_id: seller.seller_id ?? null,
          nickname: seller.nickname ?? null,
          official_store_id: seller.official_store_id ?? null,
          official_store: seller.official_store ?? null,
          location: seller.location ?? null,
        }
      : null,
    seller_reputation: seller_reputation ?? null,
  };
}

// ============================================================================
// Schema — validação final com Zod (mantém seu padrão)
// ============================================================================

const InsightSchema = z.object({
  headline: z.string(),
  scores: z.object({
    seo: z.number().min(0).max(100),
    preco: z.number().min(0).max(100),
    frete: z.number().min(0).max(100),
    conversao: z.number().min(0).max(100),
    risco: z.number().min(0).max(100),
  }),
  insights: z.array(
    z.object({
      tipo: z.enum([
        "titulo",
        "preco",
        "frete",
        "estoque",
        "reputacao",
        "catalogo",
        "premium",
        "conversao",
        "outros",
      ]),
      severidade: z.enum(["alta", "media", "baixa"]),
      o_que_esta_ruim: z.string(),
      acao_recomendada: z.string(),
      impacto_esperado: z.string(),
      evidencias: z.array(z.string()).default([]),
    })
  ),
  experimentos: z
    .array(
      z.object({
        nome: z.string(),
        hipotese: z.string(),
        variacoes: z.array(z.string()),
        metrica: z.string(),
      })
    )
    .default([]),
  missing_data: z.array(z.string()).default([]),
});

// ============================================================================
// ✅ Structured Output Schema pro @google/genai (Type.*)
// (Isso é o que evita o "Unterminated string in JSON...")
// ============================================================================

const InsightResponseSchema = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    scores: {
      type: Type.OBJECT,
      properties: {
        seo: { type: Type.NUMBER },
        preco: { type: Type.NUMBER },
        frete: { type: Type.NUMBER },
        conversao: { type: Type.NUMBER },
        risco: { type: Type.NUMBER },
      },
      required: ["seo", "preco", "frete", "conversao", "risco"],
    },
    insights: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tipo: {
            type: Type.STRING,
            enum: [
              "titulo",
              "preco",
              "frete",
              "estoque",
              "reputacao",
              "catalogo",
              "premium",
              "conversao",
              "outros",
            ],
          },
          severidade: { type: Type.STRING, enum: ["alta", "media", "baixa"] },
          o_que_esta_ruim: { type: Type.STRING },
          acao_recomendada: { type: Type.STRING },
          impacto_esperado: { type: Type.STRING },
          evidencias: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          "tipo",
          "severidade",
          "o_que_esta_ruim",
          "acao_recomendada",
          "impacto_esperado",
          "evidencias",
        ],
      },
    },
    experimentos: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          nome: { type: Type.STRING },
          hipotese: { type: Type.STRING },
          variacoes: { type: Type.ARRAY, items: { type: Type.STRING } },
          metrica: { type: Type.STRING },
        },
        required: ["nome", "hipotese", "variacoes", "metrica"],
      },
    },
    missing_data: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["headline", "scores", "insights", "experimentos", "missing_data"],
};

// ============================================================================
// Prompt
// ============================================================================

function buildPrompt(analysisPack) {
  return `
Você é uma IA especialista em Mercado Livre (CRO + SEO) para análise de anúncios.

REGRAS IMPORTANTES:
- NÃO invente números ou fatos. Use apenas os dados recebidos.
- Se faltar dado importante, liste em "missing_data" e ajuste suas conclusões.
- Sempre inclua "evidencias" como chaves do JSON recebido (ex.: "summary.price", "visits.total", "shipping.cost").
- Priorize ações com maior impacto provável e menor esforço.
- Seja objetiva e prática.

Gere o diagnóstico no schema solicitado.

DADOS (JSON):
${JSON.stringify(analysisPack)}
  `.trim();
}

// ============================================================================
// Gemini call (com parse defensivo)
// ============================================================================

function stripJsonFences(s) {
  const raw = String(s ?? "").trim();
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

async function gerarInsightsComGemini(analysisPack) {
  const ai = getGeminiClient();
  const model = getGeminiModel();

  const resp = await ai.models.generateContent({
    model,
    // ✅ formato recomendado (contents.parts)
    contents: {
      parts: [{ text: buildPrompt(analysisPack) }],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: InsightResponseSchema, // ✅ ESSENCIAL
      maxOutputTokens: 900,
      temperature: 0.4,
    },
  });

  const cleaned = stripJsonFences(resp?.text);
  const parsed = JSON.parse(cleaned);
  return InsightSchema.parse(parsed); // ✅ valida
}

// ============================================================================
// Controller
// ============================================================================

module.exports = {
  async overview(req, res) {
    try {
      const mlb = normMlb(req.params.mlb);
      if (!mlb) {
        return res.status(400).json({
          ok: false,
          error: "MLB inválido. Ex: MLB123...",
        });
      }

      const days = clampDays(req.query.days || 30);
      const zip_code = normZip(req.query.zip_code);

      const accessToken = pickAccessToken(req);

      const data = await analiseAnuncioService.getOverview({
        mlb,
        accessToken,
        days,
        zip_code,
      });

      return res.json({ ok: true, ...data });
    } catch (error) {
      const code = error.statusCode || 500;
      return res.status(code).json({
        ok: false,
        error: "Erro ao carregar overview do anúncio",
        message: error.message,
      });
    }
  },

  // POST /api/analise-anuncios/insights/:mlb?days=30&zip_code=...
  async insights(req, res) {
    try {
      if (!isInsightsEnabled()) {
        return res.status(503).json({
          ok: false,
          error: "IA desabilitada (IA_INSIGHTS_ENABLED != 1).",
        });
      }

      const mlb = normMlb(req.params.mlb);
      if (!mlb) {
        return res.status(400).json({
          ok: false,
          error: "MLB inválido. Ex: MLB123...",
        });
      }

      const days = clampDays(req.query.days || 30);
      const zip_code = normZip(req.query.zip_code);

      const accessToken = pickAccessToken(req);

      const model = getGeminiModel();
      const promptVersion = "v2-schema"; // ✅ mudou pq schema mudou
      const key = cacheKeyFor({ mlb, days, zip_code, model, promptVersion });

      const cached = cacheGet(key);
      if (cached) {
        return res.json({
          ok: true,
          cached: true,
          ...cached,
          meta: {
            model,
            prompt_version: promptVersion,
            cache_ttl_sec: getCacheTtlSec(),
          },
        });
      }

      // 1) Pega overview (seu service)
      const data = await analiseAnuncioService.getOverview({
        mlb,
        accessToken,
        days,
        zip_code,
      });

      // 2) Monta pack enxuto e chama Gemini
      const analysisPack = buildAnalysisPack(data);
      const out = await gerarInsightsComGemini(analysisPack);

      // 3) Cacheia (zero custo)
      cacheSet(key, out, getCacheTtlSec());

      return res.json({
        ok: true,
        cached: false,
        ...out,
        meta: {
          fetched_at: data?.meta?.fetched_at || null,
          model,
          prompt_version: promptVersion,
          cache_ttl_sec: getCacheTtlSec(),
        },
      });
    } catch (error) {
      // Fallback que não quebra o front
      console.error("❌ Erro em insights:", error?.message || error);

      return res.status(200).json({
        ok: true,
        cached: false,
        headline: "Não foi possível gerar insights agora",
        scores: { seo: 0, preco: 0, frete: 0, conversao: 0, risco: 0 },
        insights: [
          {
            tipo: "outros",
            severidade: "baixa",
            o_que_esta_ruim:
              "A IA falhou ou houve erro ao forçar saída estruturada.",
            acao_recomendada:
              "Verifique GEMINI_API_KEY / modelo, e se persistir reduza days e mantenha cache ligado. Se estiver usando Render, confirme variáveis de ambiente e reinicie o serviço.",
            impacto_esperado: "Retomar a análise quando o serviço normalizar.",
            evidencias: [],
          },
        ],
        experimentos: [],
        missing_data: [],
        meta: {
          fallback: true,
          message: error?.message || "Erro desconhecido",
        },
      });
    }
  },
};
