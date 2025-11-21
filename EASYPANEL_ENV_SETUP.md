# 🚀 Configuração de Variáveis de Ambiente no Easypanel

## ⚠️ IMPORTANTE
O arquivo `.env.production` NÃO é usado automaticamente no Docker/Easypanel.
Você precisa configurar as variáveis manualmente no painel do Easypanel.

---

## 📋 Como Configurar no Easypanel

1. Acesse o painel do Easypanel
2. Vá para o serviço **Backend** (push-backend)
3. Clique em **Environment Variables** ou **Settings**
4. Adicione TODAS as variáveis abaixo

---

## 🔧 Variáveis Obrigatórias

Copie e cole as variáveis abaixo no Easypanel:

### Servidor
```
NODE_ENV=production
PORT=3000
API_URL=https://mch-push-backend.ajjhi1.easypanel.host
FRONTEND_URL=https://mch-push-frontend.ajjhi1.easypanel.host
CORS_ORIGIN=*
```

### MongoDB
```
MONGODB_URI=mongodb://mongo:pushmongo@217.216.65.122:3081/webpush-saas?tls=false&authSource=admin
```

### JWT
```
JWT_SECRET=25292d595d69c7d58fd13a4d8123190678382ee097ae400296fe297a42ed18241832ffa687b72ce0c332979b31867976cc6a1479b5ee076a023949b951e5553e
JWT_EXPIRE=7d
JWT_REFRESH_EXPIRE=30d
```

### VAPID (Web Push)
```
VAPID_PUBLIC_KEY=BCh0g6RkPqUBZruQbFGQk_0hm-DFhDJwu8s72UVC-IGEpzKrbq-ngmrlnNlI4CLYIEm6xe6ccso-UJ8QMYpWlfw
VAPID_PRIVATE_KEY=rrGNEUfbrwENmNWzZvQXDYxFDiIlLkrCTwt6iOZ3Ods
VAPID_SUBJECT=mailto:admin@webpush-saas.com
```

### MinIO
```
MINIO_ENDPOINT=mch-minio.ajjhi1.easypanel.host
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=password
MINIO_BUCKET_NAME=push
```

### Segurança
```
BCRYPT_ROUNDS=10
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000
```

### Sistema
```
DEFAULT_MONTHLY_CREDITS=100
ENABLE_CREDIT_ROLLOVER=true
ADMIN_EMAIL=admin@webpush-saas.com
ADMIN_PASSWORD=ChangeThisPassword123!
TIMEZONE=America/Sao_Paulo
```

---

## ✅ Após Configurar

1. **Salve** todas as variáveis
2. **Rebuild** o serviço backend
3. **Aguarde** o deploy completar
4. **Teste** acessando: https://mch-push-backend.ajjhi1.easypanel.host/health

Se o endpoint `/health` retornar:
```json
{
  "success": true,
  "version": "v2-cors-wildcard"
}
```

Está funcionando! ✅

---

## 🔒 Segurança

⚠️ **NUNCA** faça commit deste arquivo ou do `.env.production` para o Git!

Essas variáveis contêm informações sensíveis:
- JWT_SECRET (senha de autenticação)
- VAPID_PRIVATE_KEY (chave privada de notificações)
- MONGODB_URI (credenciais do banco)
- MINIO credentials (acesso ao storage)

---

## 📝 Notas

- **CORS_ORIGIN=\*** permite requisições de qualquer origem (mais permissivo)
- **NODE_ENV=production** ativa otimizações de produção
- **PORT=3000** porta padrão do Express (deve coincidir com Dockerfile)

---

## 🆘 Troubleshooting

### Backend não inicia?
- Verifique logs do container no Easypanel
- Confirme que MongoDB está acessível
- Confirme que MinIO está acessível

### CORS ainda dando erro?
- Verifique se TODAS as variáveis foram configuradas
- Force rebuild do backend
- Limpe cache do navegador

### 502 Bad Gateway?
- Backend está crashando, veja os logs
- Provavelmente falta alguma variável de ambiente
- MongoDB pode estar inacessível
