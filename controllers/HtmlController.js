const fs = require('fs');
const path = require('path');

class HtmlController {
  static servirDashboard(req, res) {
    const htmlPath = path.join(__dirname, '../views/dashboard.html');
    
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.send(`
        <h1>❌ Arquivo dashboard.html não encontrado</h1>
        <p><a href="/criar-dashboard">🔧 Criar dashboard automaticamente</a></p>
      `);
    }
  }

  static servirRemoverPromocao(req, res) {
    const htmlPath = path.join(__dirname, '../views/remover-promocao.html');
    
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.send(`
        <h1>❌ Arquivo remover-promocao.html não encontrado</h1>
        <p><a href="/criar-arquivo-remocao">🔧 Criar arquivo automaticamente</a></p>
      `);
    }
  }

  static criarDashboard(req, res) {
    const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Mercado Livre - Dashboard</title>
    <link rel="stylesheet" href="/css/dashboard.css">
</head>
<body>
    <div class="container">
        <h1>🛒 API Mercado Livre</h1>
        <p>Servidor Node.js rodando com sucesso!</p>
        
        <div class="endpoints">
            <div class="endpoint">
                <h3>🔑 Gerenciar Token <span class="status warning">IMPORTANTE</span></h3>
                <p>Verificar e renovar ACCESS_TOKEN</p>
                <div class="token-actions">
                    <button onclick="verificarToken()">🔍 Verificar Token</button>
                    <button onclick="renovarToken()">🔄 Renovar Token</button>
                </div>
            </div>
            
            <div class="endpoint">
                <h3>🎯 Remover Promoções <span class="status active">ATIVO</span></h3>
                <p>Interface para remover promoções de anúncios</p>
                <a href="/remover-promocao">Acessar Interface</a>
            </div>
            
            <div class="endpoint">
                <h3>🔧 Debug <span class="status active">ATIVO</span></h3>
                <p>Verificar endpoints disponíveis</p>
                <a href="/debug/routes">Ver Rotas</a>
            </div>
        </div>
    </div>

    <script src="/js/dashboard.js"></script>
</body>
</html>`;

    const htmlPath = path.join(__dirname, '../views/dashboard.html');
    
    try {
      fs.writeFileSync(htmlPath, htmlContent, 'utf8');
      res.send(`
        <h1>✅ Dashboard criado com sucesso!</h1>
        <p>O arquivo <strong>dashboard.html</strong> foi criado em:</p>
        <p><code>${htmlPath}</code></p>
        <p><a href="/">🏠 Acessar Dashboard</a></p>
      `);
    } catch (error) {
      res.status(500).send(`
        <h1>❌ Erro ao criar dashboard</h1>
        <p>Erro: ${error.message}</p>
      `);
    }
  }

  static criarArquivoRemocao(req, res) {
    const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Remover Promoções - ML</title>
    <link rel="stylesheet" href="/css/remover-promocao.css">
</head>
<body>
    <div class="container">
        <h1>🎯 Remover Promoções</h1>
        
        <div class="form-group">
            <label for="mlbId">MLB ID do Anúncio:</label>
            <input type="text" id="mlbId" placeholder="Ex: MLB1234567890" />
            <small>Digite o código MLB do anúncio (encontrado na URL)</small>
        </div>
        
        <div class="form-group">
            <label for="mlbIds">Múltiplos MLB IDs (um por linha):</label>
            <textarea id="mlbIds" rows="6" placeholder="MLB1234567890&#10;MLB0987654321&#10;MLB1122334455"></textarea>
            <small>Para remover promoções de vários anúncios de uma vez</small>
        </div>
        
        <button onclick="removerUnico()">🎯 Remover Único</button>
        <button class="btn-warning" onclick="removerLote()">🚀 Remover em Lote</button>
        <button class="btn-secondary" onclick="verificarStatus()">📊 Status</button>
        <button class="btn-secondary" onclick="limpar()">🧹 Limpar</button>
        
        <div id="resultado"></div>
    </div>

    <script src="/js/remover-promocao.js"></script>
</body>
</html>`;

    const htmlPath = path.join(__dirname, '../views/remover-promocao.html');
    
    try {
      fs.writeFileSync(htmlPath, htmlContent, 'utf8');
      res.send(`
        <h1>✅ Arquivo criado com sucesso!</h1>
        <p>O arquivo <strong>remover-promocao.html</strong> foi criado em:</p>
        <p><code>${htmlPath}</code></p>
        <p><a href="/remover-promocao">🎯 Acessar Interface de Remoção</a></p>
        <p><a href="/">← Voltar ao Dashboard</a></p>
      `);
    } catch (error) {
      res.status(500).send(`
        <h1>❌ Erro ao criar arquivo</h1>
        <p>Erro: ${error.message}</p>
        <p><a href="/">← Voltar ao Dashboard</a></p>
      `);
    }
  }

  // Adicionar este método ao HtmlController existente
criarPromocao(req, res) {
    res.sendFile(path.join(__dirname, '../views/criar-promocao.html'));
}

  static debugRoutes(req, res) {
    const routes = [];
    
    req.app._router.stack.forEach(function(r){
      if (r.route && r.route.path){
        routes.push({
          method: Object.keys(r.route.methods)[0].toUpperCase(),
          path: r.route.path
        });
      }
    });
    
    res.json({
      total_routes: routes.length,
      routes: routes.sort((a, b) => a.path.localeCompare(b.path))
    });
  }
}

module.exports = HtmlController;