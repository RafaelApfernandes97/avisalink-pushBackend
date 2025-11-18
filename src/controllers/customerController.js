const Customer = require('../models/Customer');
const AuditLog = require('../models/AuditLog');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

// Get all customers
exports.getCustomers = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    status,
    tags,
    search
  } = req.query;

  const query = { tenant_id: req.tenant._id };

  // Filter by opt-in status
  if (status) {
    query.opt_in_status = status;
  }

  // Filter by tags
  if (tags) {
    const tagArray = tags.split(',').map(tag => tag.trim());
    query.tags = { $in: tagArray };
  }

  // Search by customer identifier
  if (search) {
    query.customer_identifier = { $regex: search, $options: 'i' };
  }

  const skip = (page - 1) * limit;

  const [customers, total] = await Promise.all([
    Customer.find(query)
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean(),
    Customer.countDocuments(query)
  ]);

  paginatedResponse(res, 200, customers, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});

// Get customer by ID
exports.getCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!customer) {
    return next(new NotFoundError('Customer not found'));
  }

  successResponse(res, 200, customer);
});

// Update customer
exports.updateCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!customer) {
    return next(new NotFoundError('Customer not found'));
  }

  const { tags, customer_identifier, custom_data } = req.body;

  if (tags !== undefined) {
    customer.tags = tags;
  }

  if (customer_identifier !== undefined) {
    customer.customer_identifier = customer_identifier;
  }

  if (custom_data !== undefined) {
    customer.custom_data = new Map(Object.entries(custom_data));
  }

  await customer.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: req.tenant._id,
    user_id: req.user._id,
    action: 'customer_updated',
    resource_type: 'customer',
    resource_id: customer._id,
    details: {
      tags_updated: tags !== undefined,
      identifier_updated: customer_identifier !== undefined
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Customer updated successfully', {
    customer_id: customer._id,
    tenant_id: req.tenant._id,
    updated_by: req.user._id
  });

  successResponse(res, 200, customer, 'Customer updated successfully');
});

// Delete customer (unsubscribe)
exports.deleteCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!customer) {
    return next(new NotFoundError('Customer not found'));
  }

  const reason = req.body.reason || 'Unsubscribed by admin';

  await customer.unsubscribe(reason);

  // Create audit log
  await AuditLog.log({
    tenant_id: req.tenant._id,
    user_id: req.user._id,
    action: 'customer_unsubscribed',
    resource_type: 'customer',
    resource_id: customer._id,
    details: {
      reason,
      unsubscribed_by_admin: true
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Customer unsubscribed', {
    customer_id: customer._id,
    tenant_id: req.tenant._id,
    unsubscribed_by: req.user._id
  });

  successResponse(res, 200, customer, 'Customer unsubscribed successfully');
});

// Get customer statistics
exports.getStats = asyncHandler(async (req, res, next) => {
  const tenantId = req.tenant._id;

  // Get counts by status
  const [
    total,
    active,
    pending,
    unsubscribed,
    expired
  ] = await Promise.all([
    Customer.countDocuments({ tenant_id: tenantId }),
    Customer.countDocuments({ tenant_id: tenantId, opt_in_status: 'active' }),
    Customer.countDocuments({ tenant_id: tenantId, opt_in_status: 'pending' }),
    Customer.countDocuments({ tenant_id: tenantId, opt_in_status: 'unsubscribed' }),
    Customer.countDocuments({ tenant_id: tenantId, opt_in_status: 'expired' })
  ]);

  // Get growth stats (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const newSubscriptionsLast30Days = await Customer.countDocuments({
    tenant_id: tenantId,
    opt_in_status: 'active',
    opt_in_date: { $gte: thirtyDaysAgo }
  });

  // Get notification stats
  const notificationStats = await Customer.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        opt_in_status: 'active'
      }
    },
    {
      $group: {
        _id: null,
        total_sent: { $sum: '$notification_stats.total_sent' },
        total_delivered: { $sum: '$notification_stats.total_delivered' },
        total_failed: { $sum: '$notification_stats.total_failed' },
        total_clicked: { $sum: '$notification_stats.total_clicked' }
      }
    }
  ]);

  const stats = notificationStats[0] || {
    total_sent: 0,
    total_delivered: 0,
    total_failed: 0,
    total_clicked: 0
  };

  // Get top tags
  const topTags = await Customer.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        opt_in_status: 'active'
      }
    },
    {
      $unwind: '$tags'
    },
    {
      $group: {
        _id: '$tags',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    },
    {
      $limit: 10
    }
  ]);

  // Get device breakdown
  const deviceBreakdown = await Customer.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        opt_in_status: 'active'
      }
    },
    {
      $group: {
        _id: '$opt_in_metadata.device_type',
        count: { $sum: 1 }
      }
    }
  ]);

  // Get browser breakdown
  const browserBreakdown = await Customer.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        opt_in_status: 'active'
      }
    },
    {
      $group: {
        _id: '$opt_in_metadata.browser',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);

  const deliveryRate = stats.total_sent > 0
    ? ((stats.total_delivered / stats.total_sent) * 100).toFixed(2)
    : 0;

  const clickRate = stats.total_delivered > 0
    ? ((stats.total_clicked / stats.total_delivered) * 100).toFixed(2)
    : 0;

  const statsData = {
    overview: {
      total,
      active,
      pending,
      unsubscribed,
      expired,
      new_last_30_days: newSubscriptionsLast30Days
    },
    notifications: {
      total_sent: stats.total_sent,
      total_delivered: stats.total_delivered,
      total_failed: stats.total_failed,
      total_clicked: stats.total_clicked,
      delivery_rate: parseFloat(deliveryRate),
      click_rate: parseFloat(clickRate)
    },
    tags: topTags.map(tag => ({
      tag: tag._id,
      count: tag.count
    })),
    devices: deviceBreakdown.map(device => ({
      type: device._id || 'Unknown',
      count: device.count
    })),
    browsers: browserBreakdown.map(browser => ({
      name: browser._id || 'Unknown',
      count: browser.count
    }))
  };

  successResponse(res, 200, statsData);
});

// Bulk import customers
exports.bulkImport = asyncHandler(async (req, res, next) => {
  const { customers } = req.body;

  if (!Array.isArray(customers) || customers.length === 0) {
    return errorResponse(res, 400, 'Customers array is required');
  }

  if (customers.length > 1000) {
    return errorResponse(res, 400, 'Maximum 1000 customers per import');
  }

  const tenantId = req.tenant._id;
  const results = {
    success: 0,
    failed: 0,
    errors: []
  };

  for (const customerData of customers) {
    try {
      // Validate required fields
      if (!customerData.subscription || !customerData.subscription.endpoint) {
        results.failed++;
        results.errors.push({
          customer: customerData,
          error: 'Missing subscription endpoint'
        });
        continue;
      }

      // Check if customer already exists
      const existing = await Customer.findOne({
        'subscription.endpoint': customerData.subscription.endpoint
      });

      if (existing) {
        results.failed++;
        results.errors.push({
          customer: customerData,
          error: 'Customer already exists'
        });
        continue;
      }

      // Create customer
      await Customer.create({
        tenant_id: tenantId,
        subscription: customerData.subscription,
        customer_identifier: customerData.customer_identifier,
        tags: customerData.tags || [],
        custom_data: customerData.custom_data ? new Map(Object.entries(customerData.custom_data)) : new Map(),
        opt_in_status: 'active',
        opt_in_date: new Date(),
        opt_in_metadata: {
          ip_address: req.ip,
          user_agent: req.get('user-agent')
        }
      });

      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        customer: customerData,
        error: error.message
      });
    }
  }

  // Create audit log
  await AuditLog.log({
    tenant_id: tenantId,
    user_id: req.user._id,
    action: 'customer_opted_in',
    resource_type: 'customer',
    details: {
      bulk_import: true,
      total: customers.length,
      success: results.success,
      failed: results.failed
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Bulk customer import completed', {
    tenant_id: tenantId,
    total: customers.length,
    success: results.success,
    failed: results.failed
  });

  successResponse(res, 200, results, 'Bulk import completed');
});

// Export customers
exports.exportCustomers = asyncHandler(async (req, res, next) => {
  const {
    status,
    tags,
    format = 'json'
  } = req.query;

  const query = { tenant_id: req.tenant._id };

  if (status) {
    query.opt_in_status = status;
  }

  if (tags) {
    const tagArray = tags.split(',').map(tag => tag.trim());
    query.tags = { $in: tagArray };
  }

  const customers = await Customer.find(query)
    .select('-__v')
    .lean();

  if (format === 'csv') {
    // Convert to CSV format
    const csv = convertToCSV(customers);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=customers.csv');
    return res.send(csv);
  }

  // Default JSON format
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=customers.json');
  successResponse(res, 200, customers);
});

// Helper function to convert to CSV
function convertToCSV(customers) {
  if (customers.length === 0) return '';

  const headers = [
    'ID',
    'Customer Identifier',
    'Status',
    'Tags',
    'Opt-in Date',
    'Total Sent',
    'Total Delivered',
    'Total Clicked'
  ];

  const rows = customers.map(customer => [
    customer._id,
    customer.customer_identifier || '',
    customer.opt_in_status,
    customer.tags.join(';'),
    customer.opt_in_date || '',
    customer.notification_stats.total_sent,
    customer.notification_stats.total_delivered,
    customer.notification_stats.total_clicked
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(field => `"${field}"`).join(','))
  ].join('\n');

  return csvContent;
}

// Get customer notification history
exports.getCustomerNotifications = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20
  } = req.query;

  const customer = await Customer.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!customer) {
    return next(new NotFoundError('Customer not found'));
  }

  const NotificationLog = require('../models/NotificationLog');

  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    NotificationLog.find({ customer_id: customer._id })
      .populate('notification_id', 'title message created_at')
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean(),
    NotificationLog.countDocuments({ customer_id: customer._id })
  ]);

  paginatedResponse(res, 200, logs, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});
