```
ml_render_fixed
├─ CHANGES.diff
├─ config
│  ├─ accounts.js
│  └─ config.js
├─ controllers
│  ├─ AnaliseAnuncioController.js
│  ├─ CriarPromocaoController.js
│  ├─ DashboardController.js
│  ├─ EditarAnuncioController.js
│  ├─ EstrategicosController.js
│  ├─ ExcluirAnuncioController.js
│  ├─ FullController.js
│  ├─ HtmlController.js
│  ├─ ItemsController.js
│  ├─ JardinagemController.js
│  ├─ keywordAnalyticsController.js
│  ├─ pesquisaDescricaoController.js
│  ├─ PrazoProducaoController.js
│  ├─ PromocoesController.js
│  ├─ PublicidadeController.js
│  ├─ RemoverPromocaoController.js
│  ├─ TokenController.js
│  └─ ValidarDimensoesController.js
├─ data
│  ├─ estrategicos
│  │  └─ estrategicos_drossi.json
│  ├─ estrategicos_drossi.json
│  ├─ full_stock.json
│  └─ logs
│     └─ full_operations.log
├─ db
│  ├─ 001_create_usuarios.sql
│  ├─ 002_create_empresas.sql
│  ├─ 003_create_empresa_usuarios.sql
│  ├─ 004_create_meli_contas.sql
│  ├─ 005_create_meli_tokens.sql
│  ├─ 006_create_oauth_states.sql
│  ├─ 007_unique_meli_user_global.sql
│  ├─ 008_add_admin_master_to_usuarios_nivel.sql
│  ├─ 009_create_schema_migrations.sql
│  ├─ 010_consolidar_migracoes.sql
│  ├─ 011_create_anuncios_estrategicos.sql
│  ├─ 012_add_columns_anuncios_estrategicos.sql
│  ├─ 013_create_anuncios_full.sql
│  ├─ 014_add_metrics_full_40d.sql
│  ├─ db.js
│  ├─ doc.txt
│  └─ migrate.js
├─ index.js
├─ lib
│  └─ redisClient.js
├─ mapa_funcoes.txt
├─ middleware
│  ├─ authMiddleware.js
│  ├─ ensureAccount.js
│  ├─ ensureAuth.js
│  ├─ ensurePermission.js
│  └─ jwtAuth.js
├─ package-lock.json
├─ package.json
├─ public
│  ├─ css
│  │  ├─ admin-migracoes.css
│  │  ├─ admin-usuarios.css
│  │  ├─ analise-ia.css
│  │  ├─ criar-promocao.css
│  │  ├─ curva-abc.css
│  │  ├─ dashboard.css
│  │  ├─ editar-anuncio.css
│  │  ├─ estrategicos.css
│  │  ├─ excluir-anuncio.css
│  │  ├─ filtro-anuncios.css
│  │  ├─ full.css
│  │  ├─ jardinagem.css
│  │  ├─ keyword-analytics.css
│  │  ├─ login.css
│  │  ├─ pesquisa-descricao.css
│  │  ├─ prazo.css
│  │  ├─ promo-jobs.css
│  │  ├─ publicidade.css
│  │  ├─ remover-promocao.css
│  │  ├─ selecao-plataforma.css
│  │  └─ select-conta.css
│  ├─ img
│  │  └─ davantti.png
│  └─ js
│     ├─ account-bar.js
│     ├─ admin-backup.js
│     ├─ admin-empresas.js
│     ├─ admin-meli-contas.js
│     ├─ admin-meli-tokens.js
│     ├─ admin-migracoes.js
│     ├─ admin-oauth-states.js
│     ├─ admin-usuarios.js
│     ├─ admin-vinculos.js
│     ├─ analise-ia.js
│     ├─ criar-promocao.js
│     ├─ dashboard.js
│     ├─ editar-anuncio.js
│     ├─ estrategicos.js
│     ├─ excluir-anuncio.js
│     ├─ exclusao-bulk.js
│     ├─ filtro-anuncios.js
│     ├─ full.js
│     ├─ ia-analytics-curva-abc.js
│     ├─ jardinagem-bulk.js
│     ├─ jardinagem.js
│     ├─ jobs-panel.js
│     ├─ keyword-analytics.js
│     ├─ pesquisa-descricao.js
│     ├─ prazo-bulk.js
│     ├─ prazo.js
│     ├─ promo-bulk.js
│     ├─ publicidade.js
│     ├─ remocao-bulk.js
│     ├─ remover-promocao.js
│     ├─ select-conta.js
│     └─ validar-dimensoes.js
├─ README.md
├─ render.yaml
├─ results
│  ├─ 10_filtro_metadata.json
│  ├─ 10_filtro_resultados.json
│  ├─ 11_filtro_metadata.json
│  ├─ 11_filtro_resultados.json
│  ├─ 1_filtro_metadata.json
│  ├─ 1_filtro_resultados.json
│  ├─ 2_filtro_metadata.json
│  ├─ 2_filtro_resultados.json
│  ├─ 3_filtro_metadata.json
│  ├─ 3_filtro_resultados.json
│  ├─ 4_filtro_metadata.json
│  ├─ 4_filtro_resultados.json
│  ├─ 5_filtro_metadata.json
│  ├─ 5_filtro_resultados.json
│  ├─ 6_filtro_metadata.json
│  ├─ 6_filtro_resultados.json
│  ├─ 7_filtro_metadata.json
│  ├─ 7_filtro_resultados.json
│  ├─ 8_filtro_metadata.json
│  ├─ 8_filtro_resultados.json
│  ├─ 9_filtro_metadata.json
│  ├─ 9_filtro_resultados.json
│  ├─ job_1756141867517_5l1xtles5_metadata.json
│  └─ job_1756141867517_5l1xtles5_resultados.jsonl
├─ routes
│  ├─ accountRoutes.js
│  ├─ adminBackupRoutes.js
│  ├─ adminEmpresasRoutes.js
│  ├─ adminMeliContasRoutes.js
│  ├─ adminMeliTokensRoutes.js
│  ├─ adminMigracoesRoutes.js
│  ├─ adminOAuthStatesRoutes.js
│  ├─ adminUsuariosRoutes.js
│  ├─ adminVinculosRoutes.js
│  ├─ AnaliseAnuncioRoutes.js
│  ├─ analytics-abc-Routes.js
│  ├─ analytics-filtro-anuncios-routes.js
│  ├─ authRoutes.js
│  ├─ criarPromocaoRoutes.js
│  ├─ dashboardRoutes.js
│  ├─ editarAnuncioRoutes.js
│  ├─ estrategicosRoutes.js
│  ├─ excluirAnuncioRoutes.js
│  ├─ fullRoutes.js
│  ├─ htmlRoutes.js
│  ├─ itemsRoutes.js
│  ├─ jardinagemRoutes.js
│  ├─ keywordAnalyticsRoutes.js
│  ├─ meliOAuthRoutes.js
│  ├─ pesquisaDescricaoRoutes.js
│  ├─ prazoProducaoRoutes.js
│  ├─ promocoesRoutes.js
│  ├─ publicidadeRoutes.js
│  ├─ removerPromocaoRoutes.js
│  ├─ tokenRoutes.js
│  └─ validarDimensoesRoutes.js
├─ services
│  ├─ adsService.js
│  ├─ analiseAnuncioService.js
│  ├─ criarPromocaoService.js
│  ├─ csvManager.js
│  ├─ dashboardService.js
│  ├─ editarAnuncioService.js
│  ├─ estrategicosStore.js
│  ├─ excluirAnuncioService.js
│  ├─ filtroAnunciosQueueService.js
│  ├─ fullRepository.js
│  ├─ fullService.js
│  ├─ geminiInsightsService.js
│  ├─ itemsService.js
│  ├─ jardinagemService.js
│  ├─ keywordAnalyticsService.js
│  ├─ ml-auth.js
│  ├─ pesquisaDescricaoService.js
│  ├─ prazoProducaoQueueService.js
│  ├─ prazoProducaoService.js
│  ├─ productAdsService.js
│  ├─ promoBulkRemoveAdapter.js
│  ├─ promoJobsService.js
│  ├─ promoSelectionStore.js
│  ├─ queueService.js
│  ├─ removerPromocaoService.js
│  ├─ sellerPromotionsService.js
│  ├─ simpleCache.js
│  ├─ tokenService.js
│  ├─ validarDimensoesJobService.js
│  └─ validarDimensoesService.js
├─ test-controller.js
├─ utils
│  └─ helper.js
└─ views
   ├─ admin-backup.html
   ├─ admin-empresas.html
   ├─ admin-meli-contas.html
   ├─ admin-meli-tokens.html
   ├─ admin-migracoes.html
   ├─ admin-oauth-states.html
   ├─ admin-usuarios.html
   ├─ admin-vinculos.html
   ├─ analise-ia.html
   ├─ cadastro.html
   ├─ criar-promocao.html
   ├─ dashboard.html
   ├─ editar-anuncio.html
   ├─ estrategicos.html
   ├─ excluir-anuncio.html
   ├─ filtro-anuncios.html
   ├─ full.html
   ├─ ia-analytics
   │  └─ curva-abc.html
   ├─ jardinagem.html
   ├─ keyword-analytics.html
   ├─ login.html
   ├─ nao-autorizado.html
   ├─ pesquisa-descricao.html
   ├─ prazo.html
   ├─ publicidade.html
   ├─ remover-promocao.html
   ├─ selecao-plataforma.html
   ├─ select-conta.html
   ├─ validar-dimensoes.html
   └─ vincular-conta.html

```
