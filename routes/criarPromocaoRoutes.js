const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Importar o controller
const criarPromocaoController = require('../controllers/CriarPromocaoController');

// Verificar se a pasta uploads existe
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('📁 Pasta uploads criada');
}

// Configuração do multer para upload de CSV
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        cb(null, `promocoes_${timestamp}_${file.originalname}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || 
            file.mimetype === 'application/vnd.ms-excel' ||
            path.extname(file.originalname).toLowerCase() === '.csv') {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos CSV são permitidos'));
        }
    }
});

// Middleware para tratamento de erros do multer
const handleMulterError = (error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'Arquivo muito grande. Tamanho máximo: 10MB'
            });
        }
    }
    
    if (error.message === 'Apenas arquivos CSV são permitidos') {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
    
    next(error);
};

// ==================== ROTAS ====================

// Teste de conexão
router.get('/test', criarPromocaoController.testarConexao);

// Consultar promoções disponíveis
router.get('/promocoes-disponiveis', criarPromocaoController.consultarPromocoes);

// Consultar detalhes de um item específico
router.get('/item/:itemId', criarPromocaoController.consultarItem);

// Criar promoção individual
router.post('/promocao-individual/:itemId', criarPromocaoController.criarPromocaoIndividual);

// Criar promoções em massa via CSV
router.post('/promocoes-massa', upload.single('csvFile'), handleMulterError, criarPromocaoController.criarPromocoesMassa);

// Consultar status de processamento em massa
router.get('/status/:processId', criarPromocaoController.consultarStatusProcessamento);

// Listar todos os processamentos
router.get('/processamentos', criarPromocaoController.listarProcessamentos);

// Adicione esta linha após as outras rotas
router.get('/campanhas-item/:itemId', criarPromocaoController.consultarCampanhasItem);

// ==================== ROTAS DE EXEMPLO/DOCUMENTAÇÃO ====================

// Rota para gerar CSV de exemplo
router.get('/exemplo-csv', (req, res) => {
    const csvContent = `mlb_id,tipo,preco_promocional,percentual_desconto,data_inicio,data_fim
MLB123456789,PRICE_DISCOUNT,99.90,,2024-01-01T00:00:00Z,2024-01-31T23:59:59Z
MLB987654321,PRICE_DISCOUNT,,15,2024-01-01T00:00:00Z,2024-01-31T23:59:59Z
MLB555666777,SELLER_CAMPAIGN,149.90,,2024-01-01T00:00:00Z,2024-01-31T23:59:59Z`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="exemplo_promocoes.csv"');
    res.send(csvContent);
});

// Rota para documentação da API
router.get('/docs', (req, res) => {
    res.json({
        success: true,
        message: 'Documentação da API de Criação de Promoções',
        endpoints: {
            'GET /test': 'Testar conexão com API do Mercado Livre',
            'GET /promocoes-disponiveis': 'Consultar promoções disponíveis',
            'GET /item/:itemId': 'Consultar detalhes de um item',
            'POST /promocao-individual/:itemId': 'Criar promoção individual',
            'POST /promocoes-massa': 'Criar promoções em massa via CSV',
            'GET /status/:processId': 'Consultar status de processamento',
            'GET /processamentos': 'Listar todos os processamentos',
            'GET /exemplo-csv': 'Baixar CSV de exemplo',
            'GET /docs': 'Esta documentação'
        },
        tipos_promocao: [
            'PRICE_DISCOUNT - Desconto direto no preço',
            'SELLER_CAMPAIGN - Participar de campanha de vendedor'
        ],
        formato_csv: {
            colunas_obrigatorias: ['mlb_id', 'tipo'],
            colunas_opcionais: ['preco_promocional', 'percentual_desconto', 'data_inicio', 'data_fim'],
            exemplo: 'Use GET /exemplo-csv para baixar um exemplo'
        }
    });
});

module.exports = router;