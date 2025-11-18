# WebPush SaaS Platform - Backend

Backend API para plataforma SaaS de notificações push web.

## 🚀 Tecnologias

- **Node.js** - Runtime JavaScript
- **Express** - Framework web
- **MongoDB** - Banco de dados NoSQL
- **Mongoose** - ODM para MongoDB
- **Web Push** - Notificações push
- **JWT** - Autenticação
- **MinIO/S3** - Armazenamento de imagens

## 📋 Pré-requisitos

- Node.js 16.x ou superior
- MongoDB 4.4 ou superior
- Conta MinIO ou AWS S3 (para upload de imagens)

## 🔧 Instalação

1. Clone o repositório:
```bash
git clone https://github.com/seu-usuario/webpush-saas-backend.git
cd webpush-saas-backend
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
```

4. Gere as chaves VAPID para Web Push:
```bash
npx web-push generate-vapid-keys
```

Copie as chaves geradas para o arquivo `.env`:
```
VAPID_PUBLIC_KEY=sua-chave-publica
VAPID_PRIVATE_KEY=sua-chave-privada
VAPID_SUBJECT=mailto:seu-email@example.com
```

## 🎯 Configuração

### Variáveis de Ambiente

Edite o arquivo `.env` com as seguintes variáveis:

```env
# Application
NODE_ENV=production
PORT=3000
API_URL=https://seu-backend.com

# Database
MONGODB_URI=mongodb://username:password@host:port/database

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=7d

# VAPID Keys
VAPID_PUBLIC_KEY=sua-chave-publica
VAPID_PRIVATE_KEY=sua-chave-privada
VAPID_SUBJECT=mailto:seu-email@example.com

# MinIO / S3
MINIO_ENDPOINT=s3.your-server.com
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_BUCKET=push

# CORS
CORS_ORIGIN=https://seu-frontend.com
```

## 🚀 Executando

### Desenvolvimento
```bash
npm run dev
```

### Produção
```bash
npm start
```

## 📁 Estrutura do Projeto

```
src/
├── config/          # Configurações (database, minio, etc)
├── controllers/     # Controladores das rotas
├── middleware/      # Middlewares (auth, validation, etc)
├── models/          # Modelos do MongoDB
├── routes/          # Rotas da API
├── services/        # Serviços (push notifications, etc)
├── utils/           # Utilit\u00e1rios (logger, errors, etc)
├── jobs/            # Jobs agendados (cron)
├── scripts/         # Scripts de migração e manutenção
└── server.js        # Ponto de entrada da aplicação
```

## 🔐 Autenticação

A API utiliza JWT (JSON Web Tokens) para autenticação. Inclua o token no header:

```
Authorization: Bearer seu-token-jwt
```

## 📚 Endpoints Principais

### Autenticação
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Registro
- `GET /api/auth/me` - Usuário logado

### Tenants (Multi-tenancy)
- `GET /api/tenant/opt-in-links` - Listar links de opt-in
- `POST /api/tenant/opt-in-links` - Criar link de opt-in
- `GET /api/tenant/customers` - Listar clientes
- `POST /api/tenant/notifications` - Enviar notificação

### Público (Opt-in)
- `GET /api/opt-in/:token` - Detalhes do link de opt-in
- `POST /api/opt-in/:token` - Inscrever-se

## 🛠️ Scripts Úteis

### Migrar campos de clientes
```bash
node src/scripts/migrate-customer-fields.js
```

### Corrigir índices do MongoDB
```bash
node src/scripts/fix-customer-index.js
```

## 📦 Deploy

### Docker
```bash
docker build -t webpush-backend .
docker run -p 3000:3000 --env-file .env webpush-backend
```

### PM2
```bash
pm2 start src/server.js --name webpush-backend
pm2 save
pm2 startup
```

## 🔒 Segurança

- Todas as senhas são hasheadas com bcrypt
- JWT com expiração configurável
- Rate limiting em todas as rotas
- Validação de entrada com Joi
- Helmet.js para headers de segurança
- MongoDB sanitization

## 📝 Licença

Este projeto está sob a licença MIT.
