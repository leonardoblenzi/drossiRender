"use strict";

const { GoogleGenAI } = require("@google/genai");
const { z } = require("zod");
const { zodToJsonSchema } = require("zod-to-json-schema");

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
      evidencias: z.array(z.string()).default([]), // chaves do pack
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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function buildPrompt(analysisPack) {
  // Prompt simples e bem "anti-alucinação"
  return `
Você é uma IA especialista em Mercado Livre (CRO + SEO) e análise de anúncios.
Regras:
- NÃO invente números.
- Se faltar dado, liste em missing_data.
- Toda recomendação deve citar evidências (chaves do JSON recebido).
- Seja objetiva, focando ações priorizadas.

Retorne APENAS JSON no schema fornecido.

DADOS (JSON):
${JSON.stringify(analysisPack)}
`.trim();
}

async function gerarInsightsGemini(analysisPack) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

  const resp = await ai.models.generateContent({
    model,
    contents: buildPrompt(analysisPack),
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: zodToJsonSchema(InsightSchema),
      maxOutputTokens: 900,
      temperature: 0.4,
    },
  });

  const parsed = JSON.parse(resp.text);
  return InsightSchema.parse(parsed);
}

module.exports = { gerarInsightsGemini };
