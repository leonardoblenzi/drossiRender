const fetch = require('node-fetch');
const config = require('../config/config');

class TokenService {
  static async renovarTokenSeNecessario() {
    try {
      const access_token = process.env.ACCESS_TOKEN;
      
      // Testar se o token atual funciona
      const testResponse = await fetch(config.urls.users_me, {
        headers: { "Authorization": `Bearer ${access_token}` }
      });

      if (testResponse.ok) {
        console.log('✅ Token atual válido');
        return access_token;
      }

      console.log('🔄 Token expirado, renovando...');
      
      // Renovar token
      const app_id = process.env.APP_ID;
      const client_secret = process.env.CLIENT_SECRET;
      const refresh_token = process.env.REFRESH_TOKEN;

      const response = await fetch(config.urls.oauth_token, {
        method: 'POST',
        headers: {
          "accept": "application/json",
          "content-type": "application/x-www-form-urlencoded"
        },
        body: `grant_type=refresh_token&client_id=${app_id}&client_secret=${client_secret}&refresh_token=${refresh_token}`
      });

      if (!response.ok) {
        throw new Error('Falha ao renovar token');
      }

      const data = await response.json();
      
      console.log('✅ Token renovado com sucesso!');
      console.log('Novo token:', data.access_token.substring(0, 20) + '...');
      
      // Atualizar variável de ambiente temporariamente
      process.env.ACCESS_TOKEN = data.access_token;
      
      return data.access_token;

    } catch (error) {
      console.error('❌ Erro ao renovar token:', error.message);
      throw error;
    }
  }

  static async renovarToken() {
    try {
      const app_id = process.env.APP_ID;
      const client_secret = process.env.CLIENT_SECRET;
      const refresh_token = process.env.REFRESH_TOKEN;

      if (!app_id || !client_secret || !refresh_token) {
        throw new Error('Credenciais não configuradas no .env');
      }

      console.log('🔄 Renovando token...');

      const response = await fetch(config.urls.oauth_token, {
        method: 'POST',
        headers: {
          "accept": "application/json",
          "content-type": "application/x-www-form-urlencoded"
        },
        body: `grant_type=refresh_token&client_id=${app_id}&client_secret=${client_secret}&refresh_token=${refresh_token}`
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Erro na API: ${errorData.error || errorData.message || 'Erro desconhecido'}`);
      }

      const data = await response.json();
      
      // Atualizar variável de ambiente em tempo real
      process.env.ACCESS_TOKEN = data.access_token;
      
      console.log('✅ Token renovado e atualizado!');
      console.log('Novo token:', data.access_token.substring(0, 20) + '...');

      // Testar o novo token
      const testResponse = await fetch(config.urls.users_me, {
        headers: { "Authorization": `Bearer ${data.access_token}` }
      });

      if (testResponse.ok) {
        const userData = await testResponse.json();
        
        return {
          success: true,
          message: 'Token renovado e testado com sucesso!',
          access_token: data.access_token,
          expires_in: data.expires_in,
          user_id: userData.id,
          nickname: userData.nickname,
          refresh_token: data.refresh_token || refresh_token
        };
      } else {
        throw new Error('Token renovado mas não funciona');
      }

    } catch (error) {
      console.error('❌ Erro ao renovar token:', error);
      throw error;
    }
  }

  static async verificarToken() {
    try {
      const access_token = process.env.ACCESS_TOKEN;
      
      if (!access_token) {
        throw new Error('ACCESS_TOKEN não configurado');
      }

      // Testar token atual
      const testResponse = await fetch(config.urls.users_me, {
        headers: { "Authorization": `Bearer ${access_token}` }
      });

      if (testResponse.ok) {
        const userData = await testResponse.json();
        return {
          success: true,
          message: 'Token válido',
          user_id: userData.id,
          nickname: userData.nickname,
          token_preview: access_token.substring(0, 20) + '...'
        };
      } else {
        // Token inválido, tentar renovar automaticamente
        console.log('🔄 Token inválido, tentando renovar...');
        
        const renovarResult = await this.renovarToken();
        
        return {
          success: true,
          message: 'Token era inválido mas foi renovado automaticamente',
          ...renovarResult
        };
      }

    } catch (error) {
      throw error;
    }
  }

  static async testarToken() {
    try {
      const access_token = process.env.ACCESS_TOKEN;
      if (!access_token) {
        throw new Error('ACCESS_TOKEN não configurado no .env');
      }

      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      };

      const response = await fetch(config.urls.users_me, { headers });
      
      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          user_id: data.id,
          nickname: data.nickname,
          message: "Token funcionando perfeitamente!"
        };
      } else {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData,
          message: "Token com problema"
        };
      }
    } catch (error) {
      throw error;
    }
  }

  static async obterAccessToken(app_id, client_secret, refresh_token) {
    try {
      const response = await fetch(config.urls.oauth_token, {
        method: 'POST',
        headers: {
          "accept": "application/json",
          "content-type": "application/x-www-form-urlencoded"
        },
        body: `grant_type=refresh_token&client_id=${app_id}&client_secret=${client_secret}&refresh_token=${refresh_token}`
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Erro na API: ${errorData.error || errorData.message || 'Erro desconhecido'}`);
      }

      const data = await response.json();
      
      console.log('Token renovado com sucesso:', {
        access_token: data.access_token,
        expires_in: data.expires_in,
        refresh_token: data.refresh_token
      });

      return {
        success: true,
        access_token: data.access_token,
        expires_in: data.expires_in,
        refresh_token: data.refresh_token || refresh_token
      };

    } catch (error) {
      throw error;
    }
  }

  static async obterTokenInicial(app_id, client_secret, code, redirect_uri) {
    try {
      const dados = `grant_type=authorization_code&client_id=${app_id}&client_secret=${client_secret}&code=${code}&redirect_uri=${redirect_uri}`;

      const response = await fetch(config.urls.oauth_token, {
        method: 'POST',
        headers: {
          "accept": "application/json",
          "content-type": "application/x-www-form-urlencoded"
        },
        body: dados
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Erro na API: ${errorData.message || 'Erro desconhecido'}`);
      }

      const data = await response.json();
      
      console.log('Resposta da API:', data);

      return data;

    } catch (error) {
      throw error;
    }
  }
}

module.exports = TokenService;