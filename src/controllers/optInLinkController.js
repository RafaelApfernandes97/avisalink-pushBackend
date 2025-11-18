const OptInLink = require('../models/OptInLink');
const AuditLog = require('../models/AuditLog');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

// Create opt-in link
exports.createLink = asyncHandler(async (req, res, next) => {
  const {
    name,
    description,
    status,
    expiry_date,
    customization,
    form_fields,
    targeting
  } = req.body;

  const tenantId = req.tenant._id;

  // Generate unique token
  const { v4: uuidv4 } = require('uuid');
  const token = uuidv4();

  const optInLink = await OptInLink.create({
    tenant_id: tenantId,
    token,
    name,
    description,
    status,
    expiry_date,
    customization: {
      company_name: customization?.company_name,
      page_title: customization?.page_title,
      page_description: customization?.page_description,
      button_text: customization?.button_text,
      success_message: customization?.success_message,
      logo_url: customization?.logo_url,
      primary_color: customization?.primary_color,
      secondary_color: customization?.secondary_color,
      background_color: customization?.background_color,
      text_color: customization?.text_color,
      button_text_color: customization?.button_text_color
    },
    form_fields: {
      require_name: form_fields?.require_name,
      require_email: form_fields?.require_email,
      require_phone: form_fields?.require_phone,
      custom_fields: form_fields?.custom_fields
    },
    targeting,
    created_by: req.user._id
  });

  // Generate public URL
  const publicUrl = `${process.env.API_URL}/api/opt-in/${optInLink.token}`;

  // Create audit log
  await AuditLog.log({
    tenant_id: tenantId,
    user_id: req.user._id,
    action: 'opt_in_link_created',
    resource_type: 'opt_in_link',
    resource_id: optInLink._id,
    details: {
      name: optInLink.name,
      token: optInLink.token
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Opt-in link created', {
    opt_in_link_id: optInLink._id,
    tenant_id: tenantId,
    created_by: req.user._id
  });

  successResponse(res, 201, {
    ...optInLink.toObject(),
    public_url: publicUrl
  }, 'Opt-in link created successfully');
});

// Get all opt-in links
exports.getLinks = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    status
  } = req.query;

  const query = { tenant_id: req.tenant._id };

  if (status) {
    query.status = status;
  }

  const skip = (page - 1) * limit;

  const [links, total] = await Promise.all([
    OptInLink.find(query)
      .populate('created_by', 'email first_name last_name')
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean(),
    OptInLink.countDocuments(query)
  ]);

  // Add public URLs
  const linksWithUrls = links.map(link => ({
    ...link,
    public_url: `${process.env.API_URL}/api/opt-in/${link.token}`,
    is_expired: link.expiry_date && new Date(link.expiry_date) < new Date()
  }));

  paginatedResponse(res, 200, linksWithUrls, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});

// Get opt-in link by ID
exports.getLink = asyncHandler(async (req, res, next) => {
  const link = await OptInLink.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  }).populate('created_by', 'email first_name last_name');

  if (!link) {
    return next(new NotFoundError('Opt-in link not found'));
  }

  const linkData = {
    ...link.toObject(),
    public_url: `${process.env.API_URL}/api/opt-in/${link.token}`,
    is_expired: link.isExpired(),
    is_active: link.isActive()
  };

  successResponse(res, 200, linkData);
});

// Update opt-in link
exports.updateLink = asyncHandler(async (req, res, next) => {
  const link = await OptInLink.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!link) {
    return next(new NotFoundError('Opt-in link not found'));
  }

  const allowedUpdates = [
    'name',
    'description',
    'status',
    'expiry_date',
    'customization',
    'form_fields',
    'targeting'
  ];

  const updates = {};
  Object.keys(req.body).forEach(key => {
    if (allowedUpdates.includes(key)) {
      updates[key] = req.body[key];
    }
  });

  Object.assign(link, updates);
  await link.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: req.tenant._id,
    user_id: req.user._id,
    action: 'opt_in_link_updated',
    resource_type: 'opt_in_link',
    resource_id: link._id,
    details: {
      name: link.name
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Opt-in link updated', {
    opt_in_link_id: link._id,
    tenant_id: req.tenant._id,
    updated_by: req.user._id
  });

  successResponse(res, 200, link, 'Opt-in link updated successfully');
});

// Delete opt-in link
exports.deleteLink = asyncHandler(async (req, res, next) => {
  const link = await OptInLink.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!link) {
    return next(new NotFoundError('Opt-in link not found'));
  }

  // Soft delete - set status to inactive
  link.status = 'inactive';
  await link.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: req.tenant._id,
    user_id: req.user._id,
    action: 'opt_in_link_deleted',
    resource_type: 'opt_in_link',
    resource_id: link._id,
    details: {
      name: link.name,
      token: link.token
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Opt-in link deleted', {
    opt_in_link_id: link._id,
    tenant_id: req.tenant._id,
    deleted_by: req.user._id
  });

  successResponse(res, 200, null, 'Opt-in link deleted successfully');
});

// Get opt-in link statistics
exports.getLinkStats = asyncHandler(async (req, res, next) => {
  const link = await OptInLink.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!link) {
    return next(new NotFoundError('Opt-in link not found'));
  }

  const Customer = require('../models/Customer');

  // Get customers who used this opt-in link
  const customers = await Customer.find({
    tenant_id: req.tenant._id,
    opt_in_token: link.token
  });

  const activeCustomers = customers.filter(c => c.opt_in_status === 'active').length;
  const unsubscribedCustomers = customers.filter(c => c.opt_in_status === 'unsubscribed').length;

  // Get opt-ins over time (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const optInsOverTime = await Customer.aggregate([
    {
      $match: {
        tenant_id: req.tenant._id,
        opt_in_token: link.token,
        opt_in_date: { $gte: thirtyDaysAgo }
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

  const statsData = {
    link_info: {
      name: link.name,
      token: link.token,
      status: link.status,
      is_expired: link.isExpired(),
      is_active: link.isActive(),
      created_at: link.created_at
    },
    performance: {
      total_views: link.stats.total_views,
      total_subscriptions: link.stats.total_subscriptions,
      conversion_rate: link.stats.conversion_rate,
      active_customers: activeCustomers,
      unsubscribed_customers: unsubscribedCustomers,
      retention_rate: link.stats.total_subscriptions > 0
        ? ((activeCustomers / link.stats.total_subscriptions) * 100).toFixed(2)
        : 0
    },
    opt_ins_over_time: optInsOverTime.map(day => ({
      date: day._id,
      count: day.count
    }))
  };

  successResponse(res, 200, statsData);
});

// Regenerate opt-in link token
exports.regenerateToken = asyncHandler(async (req, res, next) => {
  const link = await OptInLink.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!link) {
    return next(new NotFoundError('Opt-in link not found'));
  }

  const { v4: uuidv4 } = require('uuid');
  const oldToken = link.token;

  link.token = uuidv4();
  await link.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: req.tenant._id,
    user_id: req.user._id,
    action: 'opt_in_link_updated',
    resource_type: 'opt_in_link',
    resource_id: link._id,
    details: {
      name: link.name,
      action: 'Token regenerated',
      old_token: oldToken,
      new_token: link.token
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'warning'
  });

  logger.warn('Opt-in link token regenerated', {
    opt_in_link_id: link._id,
    tenant_id: req.tenant._id,
    regenerated_by: req.user._id
  });

  successResponse(res, 200, {
    ...link.toObject(),
    public_url: `${process.env.API_URL}/api/opt-in/${link.token}`
  }, 'Token regenerated successfully');
});
