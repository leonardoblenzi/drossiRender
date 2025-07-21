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
drossiAPI
├─ .env
├─ config
│  └─ config.js
├─ controllers
│  ├─ HtmlController.js
│  ├─ PromocaoController.js
│  └─ TokenController.js
├─ index.js
├─ middleware
│  └─ authMiddleware.js
├─ package-lock.json
├─ package.json
├─ public
│  ├─ css
│  │  ├─ dashboard.css
│  │  └─ remover-promocao.css
│  └─ js
│     ├─ dashboard.js
│     └─ remover-promocao.js
├─ README.md
├─ routes
│  ├─ htmlRoutes.js
│  ├─ promocaoRoutes.js
│  └─ tokenRoutes.js
├─ services
│  ├─ csvManager.js
│  ├─ promocaoService.js
│  └─ tokenService.js
├─ test-controller.js
├─ utils
│  └─ helper.js
└─ views
   ├─ dashboard.html
   └─ remover-promocao.html

```