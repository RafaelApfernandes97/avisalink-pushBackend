const User = require('../models/User');
const Tenant = require('../models/Tenant');
const AuditLog = require('../models/AuditLog');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse } = require('../utils/response');
const { AuthenticationError } = require('../utils/errors');
const { generateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// Register new user (tenant-specific)
exports.register = asyncHandler(async (req, res, next) => {
  const { email, password, first_name, last_name, tenant_id } = req.body;

  // Verify tenant exists and is active
  const tenant = await Tenant.findById(tenant_id);

  if (!tenant) {
    return errorResponse(res, 404, 'Tenant not found');
  }

  if (tenant.status !== 'active') {
    return errorResponse(res, 403, 'Tenant account is not active');
  }

  // Create user
  const user = await User.create({
    email,
    password,
    first_name,
    last_name,
    tenant_id,
    role: 'operator'
  });

  // Create audit log
  await AuditLog.log({
    tenant_id,
    user_id: user._id,
    action: 'user_created',
    resource_type: 'user',
    resource_id: user._id,
    details: {
      email: user.email,
      role: user.role
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  // Generate token
  const token = generateToken(user._id);

  logger.info('User registered successfully', {
    user_id: user._id,
    tenant_id
  });

  successResponse(res, 201, {
    token,
    user: user.toSafeObject()
  }, 'User registered successfully');
});

// Login
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  // Find user with password
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    // Log failed login attempt
    await AuditLog.log({
      action: 'user_login_failed',
      resource_type: 'user',
      details: {
        email,
        reason: 'User not found'
      },
      metadata: {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      },
      severity: 'warning'
    });

    return next(new AuthenticationError('Invalid credentials'));
  }

  // Check if account is locked
  if (user.isLocked()) {
    await AuditLog.log({
      tenant_id: user.tenant_id,
      user_id: user._id,
      action: 'user_login_failed',
      resource_type: 'user',
      resource_id: user._id,
      details: {
        email,
        reason: 'Account locked'
      },
      metadata: {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      },
      severity: 'warning'
    });

    return errorResponse(res, 401, 'Account is temporarily locked due to multiple failed login attempts');
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    // Increment login attempts
    await user.incrementLoginAttempts();

    await AuditLog.log({
      tenant_id: user.tenant_id,
      user_id: user._id,
      action: 'user_login_failed',
      resource_type: 'user',
      resource_id: user._id,
      details: {
        email,
        reason: 'Invalid password',
        attempts: user.login_attempts
      },
      metadata: {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      },
      severity: 'warning'
    });

    return next(new AuthenticationError('Invalid credentials'));
  }

  // Check if user is active
  if (user.status !== 'active') {
    return next(new AuthenticationError('User account is not active'));
  }

  // If user has tenant, check tenant status
  if (user.tenant_id) {
    const tenant = await Tenant.findById(user.tenant_id);

    if (!tenant || tenant.status !== 'active') {
      return errorResponse(res, 403, 'Tenant account is not active');
    }
  }

  // Reset login attempts
  await user.resetLoginAttempts();

  // Create audit log
  await AuditLog.log({
    tenant_id: user.tenant_id,
    user_id: user._id,
    action: 'user_login',
    resource_type: 'user',
    resource_id: user._id,
    details: {
      email: user.email
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  // Generate token
  const token = generateToken(user._id);

  logger.info('User logged in successfully', {
    user_id: user._id,
    tenant_id: user.tenant_id
  });

  successResponse(res, 200, {
    token,
    user: user.toSafeObject()
  }, 'Logged in successfully');
});

// Get current user
exports.getMe = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  successResponse(res, 200, {
    user: user.toSafeObject(),
    tenant: req.tenant ? {
      _id: req.tenant._id,
      name: req.tenant.name,
      slug: req.tenant.slug,
      status: req.tenant.status,
      credits: req.tenant.credits
    } : null
  });
});

// Change password
exports.changePassword = asyncHandler(async (req, res, next) => {
  const { current_password, new_password } = req.body;

  const user = await User.findById(req.user._id).select('+password');

  // Check current password
  const isPasswordValid = await user.comparePassword(current_password);

  if (!isPasswordValid) {
    return next(new AuthenticationError('Current password is incorrect'));
  }

  // Update password
  user.password = new_password;
  await user.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: user.tenant_id,
    user_id: user._id,
    action: 'user_updated',
    resource_type: 'user',
    resource_id: user._id,
    details: {
      action: 'Password changed'
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Password changed successfully', {
    user_id: user._id
  });

  successResponse(res, 200, null, 'Password changed successfully');
});

// Logout
exports.logout = asyncHandler(async (req, res, next) => {
  // Create audit log
  await AuditLog.log({
    tenant_id: req.user.tenant_id,
    user_id: req.user._id,
    action: 'user_logout',
    resource_type: 'user',
    resource_id: req.user._id,
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  successResponse(res, 200, null, 'Logged out successfully');
});
