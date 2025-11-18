const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Customer = require('../models/Customer');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const CreditTransaction = require('../models/CreditTransaction');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, paginatedResponse } = require('../utils/response');
const logger = require('../utils/logger');

// Get global dashboard statistics
exports.getDashboard = asyncHandler(async (req, res, next) => {
  // Get counts
  const [
    totalTenants,
    activeTenants,
    suspendedTenants,
    totalUsers,
    totalCustomers,
    activeCustomers,
    totalNotificationsSent
  ] = await Promise.all([
    Tenant.countDocuments(),
    Tenant.countDocuments({ status: 'active' }),
    Tenant.countDocuments({ status: 'suspended' }),
    User.countDocuments({ role: { $ne: 'global_admin' } }),
    Customer.countDocuments(),
    Customer.countDocuments({ opt_in_status: 'active' }),
    Notification.countDocuments({ status: 'sent' })
  ]);

  // Get notification stats
  const notificationStats = await Notification.aggregate([
    {
      $match: {
        status: 'sent'
      }
    },
    {
      $group: {
        _id: null,
        total_sent: { $sum: '$stats.total_sent' },
        total_delivered: { $sum: '$stats.total_delivered' },
        total_failed: { $sum: '$stats.total_failed' },
        total_clicked: { $sum: '$stats.total_clicked' }
      }
    }
  ]);

  const stats = notificationStats[0] || {
    total_sent: 0,
    total_delivered: 0,
    total_failed: 0,
    total_clicked: 0
  };

  const deliveryRate = stats.total_sent > 0
    ? ((stats.total_delivered / stats.total_sent) * 100).toFixed(2)
    : 0;

  const clickRate = stats.total_delivered > 0
    ? ((stats.total_clicked / stats.total_delivered) * 100).toFixed(2)
    : 0;

  // Get credit stats
  const creditStats = await Tenant.aggregate([
    {
      $group: {
        _id: null,
        total_credits_allocated: { $sum: '$credits.monthly_limit' },
        total_credits_available: { $sum: '$credits.current_balance' },
        total_credits_used_this_month: { $sum: '$credits.used_this_month' }
      }
    }
  ]);

  const credits = creditStats[0] || {
    total_credits_allocated: 0,
    total_credits_available: 0,
    total_credits_used_this_month: 0
  };

  // Get recent activity
  const recentTenants = await Tenant.find()
    .sort({ created_at: -1 })
    .limit(5)
    .select('name email status created_at')
    .lean();

  // Get growth stats (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    newTenantsLast30Days,
    newCustomersLast30Days,
    notificationsSentLast30Days
  ] = await Promise.all([
    Tenant.countDocuments({ created_at: { $gte: thirtyDaysAgo } }),
    Customer.countDocuments({
      opt_in_status: 'active',
      opt_in_date: { $gte: thirtyDaysAgo }
    }),
    Notification.countDocuments({
      status: 'sent',
      sent_at: { $gte: thirtyDaysAgo }
    })
  ]);

  const dashboardData = {
    overview: {
      total_tenants: totalTenants,
      active_tenants: activeTenants,
      suspended_tenants: suspendedTenants,
      total_users: totalUsers,
      total_customers: totalCustomers,
      active_customers: activeCustomers,
      total_notifications_sent: totalNotificationsSent
    },
    notifications: {
      total_sent: stats.total_sent,
      total_delivered: stats.total_delivered,
      total_failed: stats.total_failed,
      total_clicked: stats.total_clicked,
      delivery_rate: parseFloat(deliveryRate),
      click_rate: parseFloat(clickRate)
    },
    credits: {
      total_allocated: credits.total_credits_allocated,
      total_available: credits.total_credits_available,
      total_used_this_month: credits.total_credits_used_this_month,
      usage_rate: credits.total_credits_allocated > 0
        ? ((credits.total_credits_used_this_month / credits.total_credits_allocated) * 100).toFixed(2)
        : 0
    },
    growth: {
      new_tenants_last_30_days: newTenantsLast30Days,
      new_customers_last_30_days: newCustomersLast30Days,
      notifications_sent_last_30_days: notificationsSentLast30Days
    },
    recent_tenants: recentTenants
  };

  successResponse(res, 200, dashboardData);
});

// Get global metrics
exports.getGlobalMetrics = asyncHandler(async (req, res, next) => {
  const {
    start_date,
    end_date,
    metric_type
  } = req.query;

  const now = new Date();
  const startDate = start_date ? new Date(start_date) : new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = end_date ? new Date(end_date) : now;

  const metrics = {};

  // Tenant metrics
  if (!metric_type || metric_type === 'tenants') {
    const tenantsByDay = await Tenant.aggregate([
      {
        $match: {
          created_at: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$created_at'
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    metrics.tenants_by_day = tenantsByDay.map(day => ({
      date: day._id,
      count: day.count
    }));
  }

  // Customer metrics
  if (!metric_type || metric_type === 'customers') {
    const customersByDay = await Customer.aggregate([
      {
        $match: {
          opt_in_status: 'active',
          opt_in_date: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$opt_in_date'
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    metrics.customers_by_day = customersByDay.map(day => ({
      date: day._id,
      count: day.count
    }));
  }

  // Notification metrics
  if (!metric_type || metric_type === 'notifications') {
    const notificationsByDay = await Notification.aggregate([
      {
        $match: {
          status: 'sent',
          sent_at: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$sent_at'
            }
          },
          count: { $sum: 1 },
          total_sent: { $sum: '$stats.total_sent' },
          total_delivered: { $sum: '$stats.total_delivered' }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    metrics.notifications_by_day = notificationsByDay.map(day => ({
      date: day._id,
      count: day.count,
      total_sent: day.total_sent,
      total_delivered: day.total_delivered,
      delivery_rate: day.total_sent > 0
        ? ((day.total_delivered / day.total_sent) * 100).toFixed(2)
        : 0
    }));
  }

  // Credit metrics
  if (!metric_type || metric_type === 'credits') {
    const creditsByDay = await CreditTransaction.aggregate([
      {
        $match: {
          type: 'consumption',
          created_at: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$created_at'
            }
          },
          total: { $sum: { $abs: '$amount' } }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    metrics.credits_consumed_by_day = creditsByDay.map(day => ({
      date: day._id,
      amount: day.total
    }));
  }

  successResponse(res, 200, metrics);
});

// Get global audit logs
exports.getAuditLogs = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 100,
    action,
    severity,
    tenant_id,
    start_date,
    end_date
  } = req.query;

  const options = {
    limit: parseInt(limit),
    skip: (parseInt(page) - 1) * parseInt(limit),
    action,
    severity,
    startDate: start_date,
    endDate: end_date
  };

  const query = {};

  if (tenant_id) {
    query.tenant_id = tenant_id;
  }

  if (action) {
    query.action = action;
  }

  if (severity) {
    query.severity = severity;
  }

  if (start_date || end_date) {
    query.created_at = {};
    if (start_date) {
      query.created_at.$gte = new Date(start_date);
    }
    if (end_date) {
      query.created_at.$lte = new Date(end_date);
    }
  }

  const skip = options.skip;

  const [logs, total] = await Promise.all([
    AuditLog.find(query)
      .populate('tenant_id', 'name email')
      .populate('user_id', 'email first_name last_name')
      .sort({ created_at: -1 })
      .limit(options.limit)
      .skip(skip)
      .lean(),
    AuditLog.countDocuments(query)
  ]);

  paginatedResponse(res, 200, logs, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});

// Get critical logs (errors and warnings)
exports.getCriticalLogs = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 50,
    tenant_id
  } = req.query;

  const logs = await AuditLog.getCriticalLogs(tenant_id, parseInt(limit));

  successResponse(res, 200, logs);
});

// Get tenant performance report
exports.getTenantPerformance = asyncHandler(async (req, res, next) => {
  // Get all active tenants
  const tenants = await Tenant.find({ status: 'active' })
    .select('name email credits')
    .lean();

  const performanceData = await Promise.all(
    tenants.map(async (tenant) => {
      const [
        customerCount,
        notificationCount,
        deliveryStats
      ] = await Promise.all([
        Customer.countDocuments({
          tenant_id: tenant._id,
          opt_in_status: 'active'
        }),
        Notification.countDocuments({
          tenant_id: tenant._id,
          status: 'sent'
        }),
        Notification.aggregate([
          {
            $match: {
              tenant_id: tenant._id,
              status: 'sent'
            }
          },
          {
            $group: {
              _id: null,
              total_sent: { $sum: '$stats.total_sent' },
              total_delivered: { $sum: '$stats.total_delivered' }
            }
          }
        ])
      ]);

      const stats = deliveryStats[0] || { total_sent: 0, total_delivered: 0 };
      const deliveryRate = stats.total_sent > 0
        ? ((stats.total_delivered / stats.total_sent) * 100).toFixed(2)
        : 0;

      return {
        tenant_id: tenant._id,
        tenant_name: tenant.name,
        tenant_email: tenant.email,
        customers: customerCount,
        notifications_sent: notificationCount,
        delivery_rate: parseFloat(deliveryRate),
        credits: {
          monthly_limit: tenant.credits.monthly_limit,
          current_balance: tenant.credits.current_balance,
          used_this_month: tenant.credits.used_this_month,
          usage_percentage: ((tenant.credits.used_this_month / tenant.credits.monthly_limit) * 100).toFixed(2)
        }
      };
    })
  );

  // Sort by most active (most notifications sent)
  performanceData.sort((a, b) => b.notifications_sent - a.notifications_sent);

  successResponse(res, 200, performanceData);
});

// Get system health status
exports.getSystemHealth = asyncHandler(async (req, res, next) => {
  const health = {
    status: 'healthy',
    timestamp: new Date(),
    services: {}
  };

  // Check database connection
  try {
    await Tenant.findOne().limit(1);
    health.services.database = {
      status: 'healthy',
      message: 'MongoDB connected'
    };
  } catch (error) {
    health.status = 'unhealthy';
    health.services.database = {
      status: 'unhealthy',
      message: error.message
    };
  }

  // Check if there are any critical errors in logs
  const criticalLogs = await AuditLog.countDocuments({
    severity: 'critical',
    created_at: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // Last hour
  });

  health.services.critical_errors = {
    status: criticalLogs === 0 ? 'healthy' : 'warning',
    count: criticalLogs,
    message: criticalLogs === 0 ? 'No critical errors' : `${criticalLogs} critical error(s) in the last hour`
  };

  // Check for tenants with depleted credits
  const depletedTenants = await Tenant.countDocuments({
    status: 'active',
    'credits.current_balance': 0
  });

  health.services.tenant_credits = {
    status: depletedTenants === 0 ? 'healthy' : 'info',
    depleted_tenants: depletedTenants,
    message: depletedTenants === 0 ? 'All tenants have credits' : `${depletedTenants} tenant(s) with depleted credits`
  };

  successResponse(res, 200, health);
});

// Get top tenants by usage
exports.getTopTenants = asyncHandler(async (req, res, next) => {
  const {
    metric = 'notifications',
    limit = 10
  } = req.query;

  let topTenants = [];

  if (metric === 'notifications') {
    // Top by notifications sent
    const result = await Notification.aggregate([
      {
        $match: { status: 'sent' }
      },
      {
        $group: {
          _id: '$tenant_id',
          total_notifications: { $sum: 1 },
          total_sent: { $sum: '$stats.total_sent' },
          total_delivered: { $sum: '$stats.total_delivered' }
        }
      },
      {
        $sort: { total_notifications: -1 }
      },
      {
        $limit: parseInt(limit)
      },
      {
        $lookup: {
          from: 'tenants',
          localField: '_id',
          foreignField: '_id',
          as: 'tenant'
        }
      },
      {
        $unwind: '$tenant'
      }
    ]);

    topTenants = result.map(item => ({
      tenant_id: item._id,
      tenant_name: item.tenant.name,
      total_notifications: item.total_notifications,
      total_sent: item.total_sent,
      total_delivered: item.total_delivered,
      delivery_rate: item.total_sent > 0
        ? ((item.total_delivered / item.total_sent) * 100).toFixed(2)
        : 0
    }));
  } else if (metric === 'customers') {
    // Top by active customers
    const result = await Customer.aggregate([
      {
        $match: { opt_in_status: 'active' }
      },
      {
        $group: {
          _id: '$tenant_id',
          total_customers: { $sum: 1 }
        }
      },
      {
        $sort: { total_customers: -1 }
      },
      {
        $limit: parseInt(limit)
      },
      {
        $lookup: {
          from: 'tenants',
          localField: '_id',
          foreignField: '_id',
          as: 'tenant'
        }
      },
      {
        $unwind: '$tenant'
      }
    ]);

    topTenants = result.map(item => ({
      tenant_id: item._id,
      tenant_name: item.tenant.name,
      total_customers: item.total_customers
    }));
  }

  successResponse(res, 200, topTenants);
});

// Get all users across all tenants (Global Admin only)
exports.getAllUsers = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    role,
    status,
    tenant_id,
    search
  } = req.query;

  const query = {};

  // Filter by tenant
  if (tenant_id) {
    query.tenant_id = tenant_id;
  }

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
      .populate('tenant_id', 'name email')
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .select('-password')
      .lean(),
    User.countDocuments(query)
  ]);

  paginatedResponse(res, 200, users, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});

// Create user for any tenant (Global Admin only)
exports.createUserForTenant = asyncHandler(async (req, res, next) => {
  const {
    email,
    password,
    first_name,
    last_name,
    role,
    tenant_id,
    permissions
  } = req.body;

  // Check if user with same email already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new ConflictError('User with this email already exists'));
  }

  // Validate tenant exists if not global_admin
  if (role !== 'global_admin' && tenant_id) {
    const tenant = await Tenant.findById(tenant_id);
    if (!tenant) {
      return next(new NotFoundError('Tenant not found'));
    }
  }

  // Create user
  const user = await User.create({
    email,
    password,
    first_name,
    last_name,
    tenant_id: role === 'global_admin' ? null : tenant_id,
    role: role || 'operator',
    permissions: permissions || []
  });

  // Create audit log
  await AuditLog.log({
    tenant_id: tenant_id || null,
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

  logger.info('User created by global admin', {
    user_id: user._id,
    tenant_id: tenant_id,
    created_by: req.user._id
  });

  const userResponse = user.toObject();
  delete userResponse.password;

  successResponse(res, 201, userResponse, 'User created successfully');
});

// Update user (Global Admin only)
exports.updateUserByAdmin = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const {
    first_name,
    last_name,
    email,
    role,
    status,
    permissions,
    password
  } = req.body;

  const user = await User.findById(id);

  if (!user) {
    return next(new NotFoundError('User not found'));
  }

  // Update fields
  if (first_name) user.first_name = first_name;
  if (last_name) user.last_name = last_name;
  if (email) user.email = email;
  if (role) user.role = role;
  if (status) user.status = status;
  if (permissions) user.permissions = permissions;
  if (password) user.password = password;

  await user.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: user.tenant_id,
    user_id: req.user._id,
    action: 'user_updated',
    resource_type: 'user',
    resource_id: user._id,
    details: {
      updated_fields: Object.keys(req.body)
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  const userResponse = user.toObject();
  delete userResponse.password;

  successResponse(res, 200, userResponse, 'User updated successfully');
});

// Delete user (Global Admin only)
exports.deleteUserByAdmin = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const user = await User.findById(id);

  if (!user) {
    return next(new NotFoundError('User not found'));
  }

  await user.deleteOne();

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

  logger.info('User deleted by global admin', {
    user_id: user._id,
    deleted_by: req.user._id
  });

  successResponse(res, 200, null, 'User deleted successfully');
});
