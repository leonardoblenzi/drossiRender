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
```
drossiAPI
├─ .env
├─ config
│  ├─ accounts.js
│  └─ config.js
├─ controllers
│  ├─ CriarPromocaoController.js
│  ├─ HtmlController.js
│  ├─ keywordAnalyticsController.js
│  ├─ pesquisaDescricaoController.js
│  ├─ PromocaoController.js
│  └─ TokenController.js
├─ index.js
├─ middleware
│  ├─ authMiddleware.js
│  └─ ensureAccount.js
├─ package-lock.json
├─ package.json
├─ public
│  ├─ css
│  │  ├─ criar-promocao.css
│  │  ├─ dashboard.css
│  │  ├─ keyword-analytics.css
│  │  ├─ pesquisa-descricao.css
│  │  └─ remover-promocao.css
│  └─ js
│     ├─ criar-promocao.js
│     ├─ dashboard.js
│     ├─ keyword-analytics.js
│     ├─ pesquisa-descricao.js
│     └─ remover-promocao.js
├─ README.md
├─ results
├─ routes
│  ├─ accountRoutes.js
│  ├─ criarPromocaoRoutes.js
│  ├─ htmlRoutes.js
│  ├─ keywordAnalyticsRoutes.js
│  ├─ pesquisaDescricaoRoutes.js
│  ├─ promocaoRoutes.js
│  └─ tokenRoutes.js
├─ services
│  ├─ criarPromocaoService.js
│  ├─ csvManager.js
│  ├─ keywordAnalyticsService.js
│  ├─ pesquisaDescricaoService.js
│  ├─ promocaoService.js
│  ├─ queueService.js
│  └─ tokenService.js
├─ test-controller.js
├─ uploads
├─ utils
│  └─ helper.js
└─ views
   ├─ criar-promocao.html
   ├─ dashboard.html
   ├─ keyword-analytics.html
   ├─ pesquisa-descricao.html
   ├─ remover-promocao.html
   └─ select-conta.html

```