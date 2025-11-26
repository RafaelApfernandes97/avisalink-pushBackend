require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');

const connectDatabase = require('./config/database');
const { initializeBucket } = require('./config/minio');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const { scheduleMonthlyReset } = require('./jobs/creditReset');

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const tenantRoutes = require('./routes/tenant');
const optInRoutes = require('./routes/optIn');
const publicRoutes = require('./routes/public');

// Create Express app
const app = express();

// === TRUST PROXY (Required for Easypanel/Docker) ===
// This is necessary when running behind a reverse proxy
app.set('trust proxy', true);

// === DISABLE X-POWERED-BY ===
app.disable('x-powered-by');

// === CORS - ABSOLUTE FIRST PRIORITY ===
app.use((req, res, next) => {
  const allowedOrigins = [
    "http://localhost:3001",
    "https://mch-push-frontend.ajjhi1.easypanel.host",
    "https://mch-push-frontendv1.ajjhi1.easypanel.host"
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});


// Security middleware - Minimal
app.use(mongoSanitize()); // Prevent MongoDB injection

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  }));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    cors_enabled: true,
    version: 'v2-cors-wildcard'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tenant', tenantRoutes);
app.use('/api/opt-in', optInRoutes);
app.use('/api/public', publicRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Error handler middleware (must be last)
app.use(errorHandler);

// Server startup
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    // Log direto no console para garantir visibilidade no Easypanel
    console.log('='.repeat(60));
    console.log('🚀 INICIANDO SERVIDOR BACKEND');
    console.log('='.repeat(60));
    console.log(`📦 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔧 Node Version: ${process.version}`);
    console.log(`📍 Porta: ${PORT}`);
    console.log(`🌐 API URL: ${process.env.API_URL || `http://localhost:${PORT}`}`);

    logger.info('='.repeat(60));
    logger.info('🚀 INICIANDO SERVIDOR BACKEND');
    logger.info('='.repeat(60));
    logger.info(`📦 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`🔧 Node Version: ${process.version}`);
    logger.info(`📍 Porta: ${PORT}`);
    logger.info(`🌐 API URL: ${process.env.API_URL || `http://localhost:${PORT}`}`);

    // Connect to database
    console.log('📊 Conectando ao banco de dados...');
    logger.info('📊 Conectando ao banco de dados...');
    await connectDatabase();
    console.log('✅ Banco de dados conectado com sucesso');
    logger.info('✅ Banco de dados conectado com sucesso');

    // Initialize MinIO bucket
    console.log('🗄️  Inicializando MinIO...');
    logger.info('🗄️  Inicializando MinIO...');
    await initializeBucket();
    console.log('✅ MinIO inicializado com sucesso');
    logger.info('✅ MinIO inicializado com sucesso');

    // Schedule cron jobs
    console.log('⏰ Agendando tarefas cron...');
    logger.info('⏰ Agendando tarefas cron...');
    scheduleMonthlyReset();
    console.log('✅ Tarefas cron agendadas com sucesso');
    logger.info('✅ Tarefas cron agendadas com sucesso');

    // Start server
    const server = app.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log('✅ SERVIDOR RODANDO COM SUCESSO!');
      console.log('='.repeat(60));
      console.log(`🌍 Servidor escutando na porta ${PORT}`);
      console.log(`📡 Health check: ${process.env.API_URL || `http://localhost:${PORT}`}/health`);
      console.log(`🔐 Rotas disponíveis:`);
      console.log(`   - POST /api/auth/login`);
      console.log(`   - POST /api/auth/register`);
      console.log(`   - GET  /api/admin/*`);
      console.log(`   - GET  /api/tenant/*`);
      console.log(`   - POST /api/opt-in/subscribe`);
      console.log('='.repeat(60));
      console.log('✨ Deploy realizado com sucesso! Sistema operacional.');
      console.log('='.repeat(60));

      logger.info('='.repeat(60));
      logger.info('✅ SERVIDOR RODANDO COM SUCESSO!');
      logger.info('='.repeat(60));
      logger.info(`🌍 Servidor escutando na porta ${PORT}`);
      logger.info(`📡 Health check: ${process.env.API_URL || `http://localhost:${PORT}`}/health`);
      logger.info(`🔐 Rotas disponíveis:`);
      logger.info(`   - POST /api/auth/login`);
      logger.info(`   - POST /api/auth/register`);
      logger.info(`   - GET  /api/admin/*`);
      logger.info(`   - GET  /api/tenant/*`);
      logger.info(`   - POST /api/opt-in/subscribe`);
      logger.info('='.repeat(60));
      logger.info('✨ Deploy realizado com sucesso! Sistema operacional.');
      logger.info('='.repeat(60));
    });

    // Log server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Erro: Porta ${PORT} já está em uso`);
        logger.error(`❌ Erro: Porta ${PORT} já está em uso`);
      } else {
        console.error('❌ Erro no servidor:', error);
        logger.error('❌ Erro no servidor:', error);
      }
      process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('⚠️  SIGTERM recebido: encerrando servidor...');
      logger.info('⚠️  SIGTERM recebido: encerrando servidor...');
      server.close(() => {
        console.log('✅ Servidor HTTP encerrado com sucesso');
        logger.info('✅ Servidor HTTP encerrado com sucesso');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('⚠️  SIGINT recebido: encerrando servidor...');
      logger.info('⚠️  SIGINT recebido: encerrando servidor...');
      server.close(() => {
        console.log('✅ Servidor HTTP encerrado com sucesso');
        logger.info('✅ Servidor HTTP encerrado com sucesso');
        process.exit(0);
      });
    });

    // Catch unhandled rejections
    process.on('unhandledRejection', (reason) => {
      console.error('❌ Unhandled Rejection:', reason);
      logger.error('❌ Unhandled Rejection:', reason);
      server.close(() => process.exit(1));
    });

    // Catch uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      logger.error('❌ Uncaught Exception:', error);
      server.close(() => process.exit(1));
    });

  } catch (error) {
    console.error('='.repeat(60));
    console.error('❌ FALHA AO INICIAR SERVIDOR');
    console.error('='.repeat(60));
    console.error('Erro:', error.message);
    console.error('Stack:', error.stack);
    console.error('='.repeat(60));

    logger.error('='.repeat(60));
    logger.error('❌ FALHA AO INICIAR SERVIDOR');
    logger.error('='.repeat(60));
    logger.error('Erro:', error.message);
    logger.error('Stack:', error.stack);
    logger.error('='.repeat(60));
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;
