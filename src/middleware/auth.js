const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

// Verify JWT token and attach user to request
exports.protect = async (req, res, next) => {
  try {
    let token;

    // Get token from header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Check if token exists
    if (!token) {
      return next(new AppError('Not authorized to access this route', 401));
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from token
      const user = await User.findById(decoded.id).select('+password');

      if (!user) {
        return next(new AppError('User not found', 401));
      }

      // Check if user is active
      if (user.status !== 'active') {
        return next(new AppError('User account is not active', 401));
      }

      // Check if user account is locked
      if (user.isLocked()) {
        return next(new AppError('Account is temporarily locked due to multiple failed login attempts', 401));
      }

      // Attach user to request
      req.user = user;

      // If user belongs to a tenant, attach tenant
      if (user.tenant_id) {
        const tenant = await Tenant.findById(user.tenant_id);

        if (!tenant) {
          return next(new AppError('Tenant not found', 404));
        }

        if (tenant.status !== 'active') {
          return next(new AppError('Tenant account is not active', 403));
        }

        req.tenant = tenant;
      }

      next();
    } catch (error) {
      logger.error('JWT verification error:', error);
      return next(new AppError('Not authorized to access this route', 401));
    }
  } catch (error) {
    next(error);
  }
};

// Grant access to specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          `User role '${req.user.role}' is not authorized to access this route`,
          403
        )
      );
    }
    next();
  };
};

// Check if user has specific permission
exports.checkPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user.hasPermission(permission)) {
      return next(
        new AppError(
          `You do not have permission to perform this action`,
          403
        )
      );
    }
    next();
  };
};

// Ensure user belongs to the same tenant
exports.ensureTenantAccess = (req, res, next) => {
  // Global admin can access all tenants
  if (req.user.role === 'global_admin') {
    return next();
  }

  // Get tenant ID from params or body
  const tenantId = req.params.tenantId || req.body.tenant_id || req.params.id;

  if (!tenantId) {
    return next(new AppError('Tenant ID is required', 400));
  }

  // Check if user belongs to this tenant
  if (req.user.tenant_id.toString() !== tenantId.toString()) {
    return next(new AppError('You do not have access to this tenant', 403));
  }

  next();
};

// Ensure user can only access their own data or tenant data
exports.ensureOwnership = (resourceType = 'user') => {
  return async (req, res, next) => {
    try {
      // Global admin can access everything
      if (req.user.role === 'global_admin') {
        return next();
      }

      const resourceId = req.params.id || req.params.userId || req.params.customerId;

      if (!resourceId) {
        return next(new AppError('Resource ID is required', 400));
      }

      if (resourceType === 'user') {
        // Users can only access their own data or tenant users if they're tenant admin
        if (req.user._id.toString() === resourceId.toString()) {
          return next();
        }

        if (req.user.role === 'tenant_admin') {
          const targetUser = await User.findById(resourceId);
          if (targetUser && targetUser.tenant_id.toString() === req.user.tenant_id.toString()) {
            return next();
          }
        }
      }

      return next(new AppError('You do not have access to this resource', 403));
    } catch (error) {
      next(error);
    }
  };
};

// Generate JWT token
exports.generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// Generate refresh token
exports.generateRefreshToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d'
  });
};
