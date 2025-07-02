module.exports = {
  diretorio_saida: 'C:\Users\USER\Documents\Projetos\ml',
  arquivo_csv: 'anuncios_ativos_promocao.csv',
  encoding: 'utf8',
  port: process.env.PORT || 3000,
  delay_padrao_remocao: 3000,
  
  // URLs da API do Mercado Livre
  urls: {
    oauth_token: 'https://api.mercadolibre.com/oauth/token',
    users_me: 'https://api.mercadolibre.com/users/me',
    seller_promotions: 'https://api.mercadolibre.com/seller-promotions'
  }
};