const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// General API rate limiter
exports.apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });

    res.status(429).json({
      success: false,
      error: 'Too many requests from this IP, please try again later'
    });
  }
});

// Stricter rate limiter for authentication endpoints
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  skipSuccessfulRequests: true,
  message: 'Too many authentication attempts, please try again later',
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      email: req.body.email
    });

    res.status(429).json({
      success: false,
      error: 'Too many authentication attempts, please try again later'
    });
  }
});

// Rate limiter for notification sending
exports.notificationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each tenant to 10 notification requests per minute
  message: 'Too many notification requests, please slow down',
  keyGenerator: (req) => {
    // Use tenant ID as key instead of IP
    return req.tenant ? req.tenant._id.toString() : req.ip;
  },
  handler: (req, res) => {
    logger.warn('Notification rate limit exceeded', {
      tenant_id: req.tenant ? req.tenant._id : null,
      user_id: req.user ? req.user._id : null
    });

    res.status(429).json({
      success: false,
      error: 'Too many notification requests, please slow down'
    });
  }
});

// Rate limiter for opt-in endpoints
exports.optInLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // Limit each IP to 50 opt-in requests per hour
  message: 'Too many opt-in requests, please try again later',
  handler: (req, res) => {
    logger.warn('Opt-in rate limit exceeded', {
      ip: req.ip,
      token: req.params.token
    });

    res.status(429).json({
      success: false,
      error: 'Too many opt-in requests, please try again later'
    });
  }
});

// Rate limiter for tenant creation (global admin only)
exports.tenantCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit to 10 tenant creations per hour
  message: 'Too many tenant creation requests',
  keyGenerator: (req) => {
    return req.user ? req.user._id.toString() : req.ip;
  }
});

// More permissive rate limiter for tenant dashboard/read operations
exports.tenantReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per 15 minutes (allows polling every 10s)
  message: 'Too many requests, please slow down',
  keyGenerator: (req) => {
    // Use user ID as key to allow multiple tabs/devices
    return req.user ? req.user._id.toString() : req.ip;
  },
  skip: (req) => {
    // Skip rate limiting for specific read-only endpoints in development
    if (process.env.NODE_ENV === 'development') {
      const readOnlyPaths = ['/dashboard', '/notifications', '/customers', '/credits'];
      return readOnlyPaths.some(path => req.path.includes(path)) && req.method === 'GET';
    }
    return false;
  },
  handler: (req, res) => {
    logger.warn('Tenant read rate limit exceeded', {
      user_id: req.user ? req.user._id : null,
      ip: req.ip,
      path: req.path
    });

    res.status(429).json({
      success: false,
      error: 'Too many requests, please slow down'
    });
  }
});
