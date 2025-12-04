# 🛒 API Mercado Livre - Gerenciador de Promoções

Sistema para gerenciar promoções de anúncios no Mercado Livre.

## 🚀 Funcionalidades

- ✅ Renovação automática de tokens
- 🎯 Remoção de promoções (individual e em lote)
- 📊 Dashboard de controle
- 📋 Exportação para CSV

## 🔧 Instalação

1. Clone o repositório:
```bash
git clone https://github.com/seu-usuario/nome-do-projeto.git
cd nome-do-projeto


```
```
ml_render_fixed
├─ CHANGES.diff
├─ config
│  ├─ accounts.js
│  └─ config.js
├─ controllers
│  ├─ AdAnalysisController.js
│  ├─ CriarPromocaoController.js
│  ├─ FullController.js
│  ├─ HtmlController.js
│  ├─ ItemsController.js
│  ├─ keywordAnalyticsController.js
│  ├─ pesquisaDescricaoController.js
│  ├─ PromocoesController.js
│  ├─ PublicidadeController.js
│  ├─ RemoverPromocaoController.js
│  ├─ TokenController.js
│  └─ ValidarDimensoesController.js
├─ data
│  └─ backups
├─ index.js
├─ lib
│  └─ redisClient.js
├─ middleware
│  ├─ authMiddleware.js
│  └─ ensureAccount.js
├─ package-lock.json
├─ package.json
├─ public
│  ├─ css
│  │  ├─ analise-anuncio.css
│  │  ├─ criar-promocao.css
│  │  ├─ curva-abc.css
│  │  ├─ dashboard.css
│  │  ├─ keyword-analytics.css
│  │  ├─ pesquisa-descricao.css
│  │  ├─ promo-jobs.css
│  │  ├─ publicidade.css
│  │  ├─ remover-promocao.css
│  │  └─ select-conta.css
│  └─ js
│     ├─ account-bar.js
│     ├─ analise-anuncio.js
│     ├─ criar-promocao.js
│     ├─ dashboard.js
│     ├─ full.js
│     ├─ ia-analytics-curva-abc.js
│     ├─ jobs-panel.js
│     ├─ keyword-analytics.js
│     ├─ pesquisa-descricao.js
│     ├─ promo-bulk.js
│     ├─ publicidade.js
│     ├─ remocao-bulk.js
│     ├─ remover-promocao.js
│     └─ validar-dimensoes.js
├─ README.md
├─ render.yaml
├─ results
│  ├─ job_1756141867517_5l1xtles5_metadata.json
│  └─ job_1756141867517_5l1xtles5_resultados.jsonl
├─ routes
│  ├─ accountRoutes.js
│  ├─ adAnalysisRoutes.js
│  ├─ analytics-abc-Routes.js
│  ├─ criarPromocaoRoutes.js
│  ├─ fullRoutes.js
│  ├─ htmlRoutes.js
│  ├─ itemsRoutes.js
│  ├─ keywordAnalyticsRoutes.js
│  ├─ pesquisaDescricaoRoutes.js
│  ├─ promocoesRoutes.js
│  ├─ publicidadeRoutes.js
│  ├─ removerPromocaoRoutes.js
│  ├─ tokenRoutes.js
│  └─ validarDimensoesRoutes.js
├─ services
│  ├─ adAnalysisService.js
│  ├─ adsService.js
│  ├─ criarPromocaoService.js
│  ├─ csvManager.js
│  ├─ fullDatabaseService.js
│  ├─ fullService.js
│  ├─ itemsService.js
│  ├─ keywordAnalyticsService.js
│  ├─ ml-auth.js
│  ├─ pesquisaDescricaoService.js
│  ├─ productAdsService.js
│  ├─ promoBulkRemoveAdapter.js
│  ├─ promoJobsService.js
│  ├─ promoSelectionStore.js
│  ├─ queueService.js
│  ├─ removerPromocaoService.js
│  ├─ sellerPromotionsService.js
│  ├─ tokenService.js
│  └─ validarDimensoesService.js
├─ test-controller.js
├─ utils
│  └─ helper.js
└─ views
   ├─ analise-anuncios.html
   ├─ criar-promocao.html
   ├─ dashboard.html
   ├─ full.html
   ├─ ia-analytics
   │  └─ curva-abc.html
   ├─ keyword-analytics.html
   ├─ pesquisa-descricao.html
   ├─ publicidade.html
   ├─ remover-promocao.html
   ├─ select-conta.html
   └─ validar-dimensoes.html

```