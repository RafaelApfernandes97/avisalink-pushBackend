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

// CORS configuration - Must be BEFORE other middleware
const corsOptions = {
  origin: true, // Allow any origin
  credentials: true, // Allow cookies to be sent
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Security middleware - Configure helmet to not conflict with CORS
app.use(helmet({
  crossOriginResourcePolicy: false, // Disable CORP to avoid CORS conflicts
}));
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
    timestamp: new Date().toISOString()
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
    // Connect to database
    await connectDatabase();
    logger.info('Database connected successfully');

    // Initialize MinIO bucket
    await initializeBucket();
    logger.info('MinIO initialized successfully');

    // Schedule cron jobs
    scheduleMonthlyReset();
    logger.info('Cron jobs scheduled successfully');

    // Start server
    const server = app.listen(PORT, () => {
      logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
      logger.info(`API URL: ${process.env.API_URL || `http://localhost:${PORT}`}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT signal received: closing HTTP server');
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;
