const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { NotFoundError, ConflictError, AuthorizationError } = require('../utils/errors');
const logger = require('../utils/logger');

// Create new user for tenant
exports.createUser = asyncHandler(async (req, res, next) => {
  const {
    email,
    password,
    first_name,
    last_name,
    role,
    permissions
  } = req.body;

  const tenantId = req.tenant._id;

  // Check if user with same email already exists in this tenant
  const existingUser = await User.findOne({
    email,
    tenant_id: tenantId
  });

  if (existingUser) {
    return next(new ConflictError('User with this email already exists in this tenant'));
  }

  // Only tenant_admin can create users, and cannot create global_admin
  if (role === 'global_admin') {
    return next(new AuthorizationError('Cannot create global admin users'));
  }

  // Create user
  const user = await User.create({
    email,
    password,
    first_name,
    last_name,
    tenant_id: tenantId,
    role: role || 'operator',
    permissions: permissions || []
  });

  // Create audit log
  await AuditLog.log({
    tenant_id: tenantId,
    user_id: req.user._id,
    action: 'user_created',
    resource_type: 'user',
    resource_id: user._id,
    details: {
      email: user.email,
      role: user.role,
      permissions: user.permissions
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('User created successfully', {
    user_id: user._id,
    tenant_id: tenantId,
    created_by: req.user._id
  });

  successResponse(res, 201, user.toSafeObject(), 'User created successfully');
});

// Get all users in tenant
exports.getUsers = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    role,
    status,
    search
  } = req.query;

  const query = { tenant_id: req.tenant._id };

  // Filter by role
  if (role) {
    query.role = role;
  }

  // Filter by status
  if (status) {
    query.status = status;
  }

  // Search by name or email
  if (search) {
    query.$or = [
      { first_name: { $regex: search, $options: 'i' } },
      { last_name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find(query)
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean(),
    User.countDocuments(query)
  ]);

  // Remove sensitive data
  const safeUsers = users.map(user => ({
    _id: user._id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    full_name: `${user.first_name} ${user.last_name}`,
    role: user.role,
    status: user.status,
    permissions: user.permissions,
    last_login: user.last_login,
    created_at: user.created_at
  }));

  paginatedResponse(res, 200, safeUsers, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});

// Get user by ID
exports.getUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new NotFoundError('User not found'));
  }

  // Check if user belongs to the same tenant (unless global admin)
  if (req.user.role !== 'global_admin') {
    if (user.tenant_id.toString() !== req.tenant._id.toString()) {
      return next(new AuthorizationError('You do not have access to this user'));
    }
  }

  successResponse(res, 200, user.toSafeObject());
});

// Update user
exports.updateUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new NotFoundError('User not found'));
  }

  // Check if user belongs to the same tenant
  if (req.user.role !== 'global_admin') {
    if (user.tenant_id.toString() !== req.tenant._id.toString()) {
      return next(new AuthorizationError('You do not have access to this user'));
    }
  }

  const oldData = user.toObject();

  // Update allowed fields
  const allowedUpdates = ['first_name', 'last_name', 'role', 'status', 'permissions'];
  const updates = {};

  Object.keys(req.body).forEach(key => {
    if (allowedUpdates.includes(key)) {
      // Cannot change to global_admin
      if (key === 'role' && req.body[key] === 'global_admin') {
        return;
      }
      updates[key] = req.body[key];
    }
  });

  Object.assign(user, updates);
  await user.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: user.tenant_id,
    user_id: req.user._id,
    action: 'user_updated',
    resource_type: 'user',
    resource_id: user._id,
    changes: {
      before: oldData,
      after: user.toObject()
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('User updated successfully', {
    user_id: user._id,
    updated_by: req.user._id
  });

  successResponse(res, 200, user.toSafeObject(), 'User updated successfully');
});

// Delete user
exports.deleteUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new NotFoundError('User not found'));
  }

  // Check if user belongs to the same tenant
  if (req.user.role !== 'global_admin') {
    if (user.tenant_id.toString() !== req.tenant._id.toString()) {
      return next(new AuthorizationError('You do not have access to this user'));
    }
  }

  // Cannot delete yourself
  if (user._id.toString() === req.user._id.toString()) {
    return next(new AuthorizationError('You cannot delete your own account'));
  }

  // Soft delete - set status to inactive
  user.status = 'inactive';
  await user.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: user.tenant_id,
    user_id: req.user._id,
    action: 'user_deleted',
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
    severity: 'warning'
  });

  logger.warn('User deleted (soft delete)', {
    user_id: user._id,
    deleted_by: req.user._id
  });

  successResponse(res, 200, null, 'User deleted successfully');
});

// Get user activity logs
exports.getUserActivity = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 50
  } = req.query;

  const userId = req.params.id;

  const user = await User.findById(userId);

  if (!user) {
    return next(new NotFoundError('User not found'));
  }

  // Check access
  if (req.user.role !== 'global_admin') {
    if (user.tenant_id.toString() !== req.tenant._id.toString()) {
      return next(new AuthorizationError('You do not have access to this user'));
    }
  }

  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    AuditLog.find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean(),
    AuditLog.countDocuments({ user_id: userId })
  ]);

  paginatedResponse(res, 200, logs, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});

// Reset user password (admin only)
exports.resetUserPassword = asyncHandler(async (req, res, next) => {
  const { new_password } = req.body;

  if (!new_password || new_password.length < 8) {
    return errorResponse(res, 400, 'Password must be at least 8 characters');
  }

  const user = await User.findById(req.params.id).select('+password');

  if (!user) {
    return next(new NotFoundError('User not found'));
  }

  // Check access
  if (req.user.role !== 'global_admin' && req.user.role !== 'tenant_admin') {
    return next(new AuthorizationError('Only admins can reset user passwords'));
  }

  if (req.user.role === 'tenant_admin') {
    if (user.tenant_id.toString() !== req.tenant._id.toString()) {
      return next(new AuthorizationError('You do not have access to this user'));
    }
  }

  // Update password
  user.password = new_password;
  user.login_attempts = 0;
  user.locked_until = undefined;
  await user.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: user.tenant_id,
    user_id: req.user._id,
    action: 'user_updated',
    resource_type: 'user',
    resource_id: user._id,
    details: {
      action: 'Password reset by admin'
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'warning'
  });

  logger.warn('User password reset by admin', {
    user_id: user._id,
    reset_by: req.user._id
  });

  successResponse(res, 200, null, 'Password reset successfully');
});

// Unlock user account
exports.unlockUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new NotFoundError('User not found'));
  }

  // Check access
  if (req.user.role !== 'global_admin' && req.user.role !== 'tenant_admin') {
    return next(new AuthorizationError('Only admins can unlock user accounts'));
  }

  if (req.user.role === 'tenant_admin') {
    if (user.tenant_id.toString() !== req.tenant._id.toString()) {
      return next(new AuthorizationError('You do not have access to this user'));
    }
  }

  // Unlock account
  user.login_attempts = 0;
  user.locked_until = undefined;
  await user.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: user.tenant_id,
    user_id: req.user._id,
    action: 'user_updated',
    resource_type: 'user',
    resource_id: user._id,
    details: {
      action: 'Account unlocked by admin'
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('User account unlocked', {
    user_id: user._id,
    unlocked_by: req.user._id
  });

  successResponse(res, 200, user.toSafeObject(), 'User account unlocked successfully');
});
