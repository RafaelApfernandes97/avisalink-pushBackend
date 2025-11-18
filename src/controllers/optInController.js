const OptInLink = require('../models/OptInLink');
const Customer = require('../models/Customer');
const Tenant = require('../models/Tenant');
const AuditLog = require('../models/AuditLog');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse } = require('../utils/response');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

// Get opt-in page details (Public endpoint)
exports.getOptInPage = asyncHandler(async (req, res, next) => {
  const { token } = req.params;

  const optInLink = await OptInLink.findOne({ token });

  if (!optInLink) {
    return next(new NotFoundError('Opt-in link not found'));
  }

  // Check if link is active
  if (!optInLink.isActive()) {
    return errorResponse(res, 400, 'This opt-in link is no longer active or has expired');
  }

  // Check if max subscriptions reached
  if (optInLink.hasReachedMaxSubscriptions()) {
    return errorResponse(res, 400, 'This opt-in link has reached its maximum number of subscriptions');
  }

  // Increment view count
  await optInLink.incrementViewCount();

  // Get tenant info
  const tenant = await Tenant.findById(optInLink.tenant_id).select('name');

  const pageData = {
    tenant_name: tenant?.name,
    name: optInLink.name,
    description: optInLink.description,
    customization: {
      company_name: optInLink.customization?.company_name,
      page_title: optInLink.customization?.page_title,
      page_description: optInLink.customization?.page_description,
      button_text: optInLink.customization?.button_text,
      success_message: optInLink.customization?.success_message,
      logo_url: optInLink.customization?.logo_url,
      primary_color: optInLink.customization?.primary_color,
      secondary_color: optInLink.customization?.secondary_color,
      background_color: optInLink.customization?.background_color,
      text_color: optInLink.customization?.text_color,
      button_text_color: optInLink.customization?.button_text_color
    },
    form_fields: {
      require_name: optInLink.form_fields?.require_name ?? true,
      require_email: optInLink.form_fields?.require_email ?? true,
      require_phone: optInLink.form_fields?.require_phone ?? false,
      custom_fields: optInLink.form_fields?.custom_fields || []
    },
    is_active: true
  };

  successResponse(res, 200, pageData);
});

// Submit opt-in (Public endpoint)
exports.submitOptIn = asyncHandler(async (req, res, next) => {
  const { token } = req.params;
  const {
    subscription,
    customer_identifier,
    email,
    name,
    phone,
    tags,
    custom_data
  } = req.body;

  // Log para debug
  logger.info('Submit opt-in request received', {
    token,
    email,
    name,
    phone,
    has_subscription: !!subscription
  });

  // Validate subscription object if provided
  if (subscription) {
    if (!subscription.endpoint || !subscription.keys) {
      return errorResponse(res, 400, 'Invalid subscription object');
    }

    if (!subscription.keys.p256dh || !subscription.keys.auth) {
      return errorResponse(res, 400, 'Invalid subscription keys');
    }
  }

  const optInLink = await OptInLink.findOne({ token });

  if (!optInLink) {
    return next(new NotFoundError('Opt-in link not found'));
  }

  // Check if link is active
  if (!optInLink.isActive()) {
    return errorResponse(res, 400, 'This opt-in link is no longer active or has expired');
  }

  // Check if max subscriptions reached
  if (optInLink.hasReachedMaxSubscriptions()) {
    return errorResponse(res, 400, 'This opt-in link has reached its maximum number of subscriptions');
  }

  // Check if customer already exists
  let existingCustomer = null;

  // Priority 1: Check by subscription endpoint (if provided)
  if (subscription && subscription.endpoint) {
    existingCustomer = await Customer.findOne({
      tenant_id: optInLink.tenant_id,
      'subscription.endpoint': subscription.endpoint
    });

    // If found by subscription, update email/name/phone if they changed
    if (existingCustomer) {
      let needsUpdate = false;

      if (email && existingCustomer.email !== email) {
        existingCustomer.email = email;
        needsUpdate = true;
      }

      if (name && existingCustomer.name !== name) {
        existingCustomer.name = name;
        needsUpdate = true;
      }

      if (phone && existingCustomer.phone !== phone) {
        existingCustomer.phone = phone;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await existingCustomer.save();
        logger.info('Customer info updated', {
          customer_id: existingCustomer._id,
          email: existingCustomer.email,
          name: existingCustomer.name
        });
      }
    }
  }

  // Priority 2: Check by email (if no subscription or not found by subscription)
  if (!existingCustomer && email) {
    existingCustomer = await Customer.findOne({
      tenant_id: optInLink.tenant_id,
      email: email
    });
  }

  if (existingCustomer) {
    logger.info('Existing customer found', {
      customer_id: existingCustomer._id,
      email: existingCustomer.email,
      opt_in_status: existingCustomer.opt_in_status
    });

    // If already exists and is active, just return success
    if (existingCustomer.opt_in_status === 'active') {
      logger.info('Customer already active, returning success');
      return successResponse(res, 200, {
        customer_id: existingCustomer._id,
        message: 'You are already subscribed'
      });
    }

    // If was unsubscribed, reactivate
    if (existingCustomer.opt_in_status === 'unsubscribed') {
      logger.info('Reactivating unsubscribed customer');
      await existingCustomer.activateOptIn({
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      });

      return successResponse(res, 200, {
        customer_id: existingCustomer._id,
        message: 'Subscription reactivated successfully'
      });
    }

    // If status is pending, activate it
    if (existingCustomer.opt_in_status === 'pending') {
      logger.info('Activating pending customer');
      await existingCustomer.activateOptIn({
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      });

      return successResponse(res, 200, {
        customer_id: existingCustomer._id,
        message: 'Subscription activated successfully'
      });
    }
  }

  // Parse user agent to get device info
  const userAgent = req.get('user-agent') || '';
  const deviceInfo = parseUserAgent(userAgent);

  // Merge tags from opt-in link and request
  const customerTags = [
    ...(optInLink.targeting?.tags || []),
    ...(tags || [])
  ];

  logger.info('Creating new customer', {
    email,
    name,
    phone,
    has_subscription: !!subscription
  });

  // Create new customer
  const customerData = {
    tenant_id: optInLink.tenant_id,
    opt_in_token: token,
    opt_in_status: 'pending',
    customer_identifier: customer_identifier || email || phone || subscription?.endpoint,
    name: name,
    email: email,
    phone: phone,
    tags: [...new Set(customerTags)], // Remove duplicates
    custom_data: {
      ...custom_data
    },
    opt_in_metadata: {
      ip_address: req.ip,
      user_agent: userAgent,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
      device_type: deviceInfo.device_type,
      referrer: req.get('referer')
    }
  };

  // Add subscription only if provided
  if (subscription) {
    customerData.subscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth
      }
    };
  }

  const customer = await Customer.create(customerData);

  logger.info('Customer created', {
    customer_id: customer._id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    tenant_id: customer.tenant_id
  });

  // Activate opt-in
  await customer.activateOptIn();

  logger.info('Customer opt-in activated', {
    customer_id: customer._id,
    opt_in_status: customer.opt_in_status
  });

  // Increment subscription count
  await optInLink.incrementSubscriptionCount();

  // Create audit log
  await AuditLog.log({
    tenant_id: optInLink.tenant_id,
    action: 'customer_opted_in',
    resource_type: 'customer',
    resource_id: customer._id,
    details: {
      opt_in_link: optInLink.name,
      token,
      customer_identifier
    },
    metadata: {
      ip_address: req.ip,
      user_agent: userAgent
    },
    severity: 'info'
  });

  logger.info('Customer opted in', {
    customer_id: customer._id,
    tenant_id: optInLink.tenant_id,
    opt_in_link_id: optInLink._id
  });

  successResponse(res, 201, {
    customer_id: customer._id,
    message: optInLink.customization.success_message
  }, 'Successfully subscribed to notifications');
});

// Unsubscribe (Public endpoint)
exports.unsubscribe = asyncHandler(async (req, res, next) => {
  const { token } = req.params;
  const { subscription_endpoint, reason } = req.body;

  if (!subscription_endpoint) {
    return errorResponse(res, 400, 'Subscription endpoint is required');
  }

  const customer = await Customer.findOne({
    'subscription.endpoint': subscription_endpoint
  });

  if (!customer) {
    return next(new NotFoundError('Subscription not found'));
  }

  if (customer.opt_in_status === 'unsubscribed') {
    return successResponse(res, 200, null, 'Already unsubscribed');
  }

  await customer.unsubscribe(reason || 'User requested unsubscription');

  // Create audit log
  await AuditLog.log({
    tenant_id: customer.tenant_id,
    action: 'customer_unsubscribed',
    resource_type: 'customer',
    resource_id: customer._id,
    details: {
      reason: reason || 'User requested',
      via_public_link: true
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Customer unsubscribed via public link', {
    customer_id: customer._id,
    tenant_id: customer.tenant_id
  });

  successResponse(res, 200, null, 'Successfully unsubscribed from notifications');
});

// Helper function to parse user agent
function parseUserAgent(userAgent) {
  const result = {
    browser: 'Unknown',
    os: 'Unknown',
    device_type: 'Desktop'
  };

  if (!userAgent) return result;

  // Detect browser
  if (userAgent.includes('Chrome')) {
    result.browser = 'Chrome';
  } else if (userAgent.includes('Firefox')) {
    result.browser = 'Firefox';
  } else if (userAgent.includes('Safari')) {
    result.browser = 'Safari';
  } else if (userAgent.includes('Edge')) {
    result.browser = 'Edge';
  } else if (userAgent.includes('Opera')) {
    result.browser = 'Opera';
  }

  // Detect OS
  if (userAgent.includes('Windows')) {
    result.os = 'Windows';
  } else if (userAgent.includes('Mac OS')) {
    result.os = 'macOS';
  } else if (userAgent.includes('Linux')) {
    result.os = 'Linux';
  } else if (userAgent.includes('Android')) {
    result.os = 'Android';
  } else if (userAgent.includes('iOS')) {
    result.os = 'iOS';
  }

  // Detect device type
  if (userAgent.includes('Mobile') || userAgent.includes('Android')) {
    result.device_type = 'Mobile';
  } else if (userAgent.includes('Tablet') || userAgent.includes('iPad')) {
    result.device_type = 'Tablet';
  }

  return result;
}
