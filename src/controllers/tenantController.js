const Tenant = require('../models/Tenant');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { NotFoundError, ConflictError } = require('../utils/errors');
const logger = require('../utils/logger');

// Create new tenant (Global Admin only)
exports.createTenant = asyncHandler(async (req, res, next) => {
  const {
    name,
    email,
    slug,
    credits,
    settings,
    metadata
  } = req.body;

  // Check if tenant with same email already exists
  const existingTenant = await Tenant.findOne({ email });
  if (existingTenant) {
    return next(new ConflictError('Tenant with this email already exists'));
  }

  // Create tenant
  const tenant = await Tenant.create({
    name,
    email,
    slug,
    credits: {
      monthly_limit: credits?.monthly_limit || 100,
      current_balance: credits?.monthly_limit || 100,
      rollover_enabled: credits?.rollover_enabled ?? true
    },
    settings,
    metadata
  });

  // Create audit log
  await AuditLog.log({
    tenant_id: tenant._id,
    user_id: req.user._id,
    action: 'tenant_created',
    resource_type: 'tenant',
    resource_id: tenant._id,
    details: {
      name: tenant.name,
      email: tenant.email,
      monthly_limit: tenant.credits.monthly_limit
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Tenant created successfully', {
    tenant_id: tenant._id,
    created_by: req.user._id
  });

  successResponse(res, 201, tenant, 'Tenant created successfully');
});

// Get all tenants (Global Admin only)
exports.getAllTenants = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    status,
    search
  } = req.query;

  const query = {};

  // Filter by status
  if (status) {
    query.status = status;
  }

  // Search by name or email
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { slug: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;

  const [tenants, total] = await Promise.all([
    Tenant.find(query)
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean(),
    Tenant.countDocuments(query)
  ]);

  paginatedResponse(res, 200, tenants, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});

// Get tenant by ID
exports.getTenant = asyncHandler(async (req, res, next) => {
  const tenant = await Tenant.findById(req.params.id);

  if (!tenant) {
    return next(new NotFoundError('Tenant not found'));
  }

  // Get additional stats
  const [userCount, customerCount] = await Promise.all([
    User.countDocuments({ tenant_id: tenant._id }),
    require('../models/Customer').countDocuments({ tenant_id: tenant._id, opt_in_status: 'active' })
  ]);

  const tenantData = {
    ...tenant.toObject(),
    stats: {
      total_users: userCount,
      active_customers: customerCount
    }
  };

  successResponse(res, 200, tenantData);
});

// Update tenant
exports.updateTenant = asyncHandler(async (req, res, next) => {
  const tenant = await Tenant.findById(req.params.id);

  if (!tenant) {
    return next(new NotFoundError('Tenant not found'));
  }

  const oldData = tenant.toObject();

  // Update fields
  const allowedUpdates = ['name', 'email', 'status', 'settings', 'metadata'];
  const updates = {};

  Object.keys(req.body).forEach(key => {
    if (allowedUpdates.includes(key)) {
      updates[key] = req.body[key];
    }
  });

  // Handle credits separately (only global admin can update)
  if (req.body.credits && req.user.role === 'global_admin') {
    if (req.body.credits.monthly_limit !== undefined) {
      tenant.credits.monthly_limit = req.body.credits.monthly_limit;
    }
    if (req.body.credits.rollover_enabled !== undefined) {
      tenant.credits.rollover_enabled = req.body.credits.rollover_enabled;
    }
  }

  Object.assign(tenant, updates);
  await tenant.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: tenant._id,
    user_id: req.user._id,
    action: 'tenant_updated',
    resource_type: 'tenant',
    resource_id: tenant._id,
    changes: {
      before: oldData,
      after: tenant.toObject()
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Tenant updated successfully', {
    tenant_id: tenant._id,
    updated_by: req.user._id
  });

  successResponse(res, 200, tenant, 'Tenant updated successfully');
});

// Delete tenant (soft delete)
exports.deleteTenant = asyncHandler(async (req, res, next) => {
  const tenant = await Tenant.findById(req.params.id);

  if (!tenant) {
    return next(new NotFoundError('Tenant not found'));
  }

  // Soft delete - set status to inactive
  tenant.status = 'inactive';
  await tenant.save();

  // Also deactivate all users
  await User.updateMany(
    { tenant_id: tenant._id },
    { status: 'inactive' }
  );

  // Create audit log
  await AuditLog.log({
    tenant_id: tenant._id,
    user_id: req.user._id,
    action: 'tenant_deleted',
    resource_type: 'tenant',
    resource_id: tenant._id,
    details: {
      name: tenant.name,
      email: tenant.email
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'warning'
  });

  logger.warn('Tenant deleted (soft delete)', {
    tenant_id: tenant._id,
    deleted_by: req.user._id
  });

  successResponse(res, 200, null, 'Tenant deleted successfully');
});

// Suspend tenant
exports.suspendTenant = asyncHandler(async (req, res, next) => {
  const tenant = await Tenant.findById(req.params.id);

  if (!tenant) {
    return next(new NotFoundError('Tenant not found'));
  }

  tenant.status = 'suspended';
  await tenant.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: tenant._id,
    user_id: req.user._id,
    action: 'tenant_suspended',
    resource_type: 'tenant',
    resource_id: tenant._id,
    details: {
      reason: req.body.reason || 'Not specified'
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'warning'
  });

  logger.warn('Tenant suspended', {
    tenant_id: tenant._id,
    suspended_by: req.user._id
  });

  successResponse(res, 200, tenant, 'Tenant suspended successfully');
});

// Activate tenant
exports.activateTenant = asyncHandler(async (req, res, next) => {
  const tenant = await Tenant.findById(req.params.id);

  if (!tenant) {
    return next(new NotFoundError('Tenant not found'));
  }

  tenant.status = 'active';
  await tenant.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: tenant._id,
    user_id: req.user._id,
    action: 'tenant_activated',
    resource_type: 'tenant',
    resource_id: tenant._id,
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Tenant activated', {
    tenant_id: tenant._id,
    activated_by: req.user._id
  });

  successResponse(res, 200, tenant, 'Tenant activated successfully');
});

// Get tenant dashboard (for tenant users)
exports.getDashboard = asyncHandler(async (req, res, next) => {
  const tenantId = req.tenant._id;

  const Customer = require('../models/Customer');
  const Notification = require('../models/Notification');
  const OptInLink = require('../models/OptInLink');

  // Get current month start
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Get stats in parallel
  const [
    totalCustomers,
    activeCustomers,
    unsubscribedCustomers,
    totalUsers,
    notificationsSentThisMonth,
    totalNotificationsSent,
    totalOptInLinks,
    activeOptInLinks
  ] = await Promise.all([
    Customer.countDocuments({ tenant_id: tenantId }),
    Customer.countDocuments({ tenant_id: tenantId, opt_in_status: 'active' }),
    Customer.countDocuments({ tenant_id: tenantId, opt_in_status: 'unsubscribed' }),
    User.countDocuments({ tenant_id: tenantId, status: 'active' }),
    Notification.countDocuments({
      tenant_id: tenantId,
      status: 'sent',
      sent_at: { $gte: monthStart }
    }),
    Notification.countDocuments({
      tenant_id: tenantId,
      status: 'sent'
    }),
    OptInLink.countDocuments({ tenant_id: tenantId }),
    OptInLink.countDocuments({ tenant_id: tenantId, status: 'active' })
  ]);

  // Get delivery and click rates
  const notificationStats = await Notification.aggregate([
    {
      $match: {
        tenant_id: req.tenant._id,
        status: 'sent'
      }
    },
    {
      $group: {
        _id: null,
        total_sent: { $sum: '$stats.total_sent' },
        total_delivered: { $sum: '$stats.total_delivered' },
        total_clicked: { $sum: '$stats.total_clicked' }
      }
    }
  ]);

  const stats = notificationStats[0] || {
    total_sent: 0,
    total_delivered: 0,
    total_clicked: 0
  };

  const deliveryRate = stats.total_sent > 0
    ? ((stats.total_delivered / stats.total_sent) * 100).toFixed(2)
    : 0;

  const clickRate = stats.total_delivered > 0
    ? ((stats.total_clicked / stats.total_delivered) * 100).toFixed(2)
    : 0;

  const dashboardData = {
    credits: {
      current_balance: req.tenant.credits.current_balance,
      monthly_limit: req.tenant.credits.monthly_limit,
      used_this_month: req.tenant.credits.used_this_month,
      usage_percentage: ((req.tenant.credits.used_this_month / req.tenant.credits.monthly_limit) * 100).toFixed(2)
    },
    customers: {
      total: totalCustomers,
      active: activeCustomers,
      unsubscribed: unsubscribedCustomers,
      growth_rate: 0 // TODO: Calculate growth rate
    },
    users: {
      total: totalUsers
    },
    notifications: {
      sent_this_month: notificationsSentThisMonth,
      total_sent: totalNotificationsSent,
      delivery_rate: parseFloat(deliveryRate),
      click_rate: parseFloat(clickRate),
      total_delivered: stats.total_delivered,
      total_clicked: stats.total_clicked
    },
    optInLinks: {
      total: totalOptInLinks,
      active: activeOptInLinks
    },
    tenant: {
      name: req.tenant.name,
      status: req.tenant.status,
      created_at: req.tenant.created_at
    }
  };

  successResponse(res, 200, dashboardData);
});

// Get tenant settings
exports.getSettings = asyncHandler(async (req, res, next) => {
  const tenant = await Tenant.findById(req.tenant._id);

  if (!tenant) {
    return next(new NotFoundError('Tenant not found'));
  }

  successResponse(res, 200, {
    settings: tenant.settings,
    metadata: tenant.metadata
  });
});

// Update tenant settings
exports.updateSettings = asyncHandler(async (req, res, next) => {
  const tenant = await Tenant.findById(req.tenant._id);

  if (!tenant) {
    return next(new NotFoundError('Tenant not found'));
  }

  const { settings, metadata } = req.body;

  if (settings) {
    tenant.settings = {
      ...tenant.settings,
      ...settings
    };
  }

  if (metadata) {
    tenant.metadata = {
      ...tenant.metadata,
      ...metadata
    };
  }

  await tenant.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: tenant._id,
    user_id: req.user._id,
    action: 'settings_updated',
    resource_type: 'tenant',
    resource_id: tenant._id,
    details: {
      settings_updated: !!settings,
      metadata_updated: !!metadata
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Tenant settings updated', {
    tenant_id: tenant._id,
    updated_by: req.user._id
  });

  successResponse(res, 200, {
    settings: tenant.settings,
    metadata: tenant.metadata
  }, 'Settings updated successfully');
});
