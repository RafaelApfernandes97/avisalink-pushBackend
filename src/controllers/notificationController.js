const Notification = require('../models/Notification');
const NotificationLog = require('../models/NotificationLog');
const Customer = require('../models/Customer');
const AuditLog = require('../models/AuditLog');
const webPushService = require('../services/webPushService');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { NotFoundError, InsufficientCreditsError } = require('../utils/errors');
const logger = require('../utils/logger');

// Create notification
exports.createNotification = asyncHandler(async (req, res, next) => {
  const {
    title,
    message,
    image_url,
    icon_url,
    badge_url,
    action_url,
    actions,
    targeting,
    schedule
  } = req.body;

  const tenantId = req.tenant._id;

  // Validate targeting
  if (!targeting || (!targeting.send_to_all && !targeting.customer_ids && !targeting.tags)) {
    return errorResponse(res, 400, 'Targeting is required (send_to_all, customer_ids, or tags)');
  }

  // Count targeted customers
  let targetQuery = {
    tenant_id: tenantId,
    opt_in_status: 'active'
  };

  if (targeting.customer_ids && targeting.customer_ids.length > 0) {
    targetQuery._id = { $in: targeting.customer_ids };
  } else if (targeting.tags && targeting.tags.length > 0) {
    targetQuery.tags = { $in: targeting.tags };
  }

  const targetedCount = await Customer.countDocuments(targetQuery);

  if (targetedCount === 0) {
    return errorResponse(res, 400, 'No active customers found with the specified targeting');
  }

  // Check if tenant has enough credits
  if (!req.tenant.hasCredits(targetedCount)) {
    return next(new InsufficientCreditsError(
      `Insufficient credits. Required: ${targetedCount}, Available: ${req.tenant.credits.current_balance}`
    ));
  }

  // Create notification
  const notification = await Notification.create({
    tenant_id: tenantId,
    title,
    message,
    image_url,
    icon_url,
    badge_url,
    action_url,
    actions,
    targeting,
    schedule: schedule || { status: 'immediate' },
    status: schedule?.scheduled_for ? 'pending' : 'draft',
    created_by: req.user._id,
    stats: {
      total_targeted: targetedCount
    }
  });

  logger.info('Notification created', {
    notification_id: notification._id,
    tenant_id: tenantId,
    title: notification.title,
    action_url: notification.action_url,
    has_url: !!notification.action_url
  });

  // Create audit log
  await AuditLog.log({
    tenant_id: tenantId,
    user_id: req.user._id,
    action: 'notification_created',
    resource_type: 'notification',
    resource_id: notification._id,
    details: {
      title: notification.title,
      targeted_count: targetedCount,
      scheduled: !!schedule?.scheduled_for
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Notification created', {
    notification_id: notification._id,
    tenant_id: tenantId,
    created_by: req.user._id,
    targeted_count: targetedCount
  });

  successResponse(res, 201, notification, 'Notification created successfully');
});

// Get all notifications
exports.getNotifications = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    status,
    start_date,
    end_date
  } = req.query;

  const query = { tenant_id: req.tenant._id };

  if (status) {
    query.status = status;
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

  const skip = (page - 1) * limit;

  const [notifications, total] = await Promise.all([
    Notification.find(query)
      .populate('created_by', 'email first_name last_name')
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean(),
    Notification.countDocuments(query)
  ]);

  paginatedResponse(res, 200, notifications, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});

// Get notification by ID
exports.getNotification = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  }).populate('created_by', 'email first_name last_name');

  if (!notification) {
    return next(new NotFoundError('Notification not found'));
  }

  successResponse(res, 200, notification);
});

// Update notification
exports.updateNotification = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!notification) {
    return next(new NotFoundError('Notification not found'));
  }

  // Can only update draft notifications
  if (notification.status !== 'draft') {
    return errorResponse(res, 400, 'Can only update draft notifications');
  }

  const allowedUpdates = [
    'title',
    'message',
    'image_url',
    'icon_url',
    'badge_url',
    'action_url',
    'actions',
    'targeting',
    'schedule'
  ];

  const updates = {};
  Object.keys(req.body).forEach(key => {
    if (allowedUpdates.includes(key)) {
      updates[key] = req.body[key];
    }
  });

  Object.assign(notification, updates);
  await notification.save();

  logger.info('Notification updated', {
    notification_id: notification._id,
    tenant_id: req.tenant._id,
    updated_by: req.user._id
  });

  successResponse(res, 200, notification, 'Notification updated successfully');
});

// Delete notification
exports.deleteNotification = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!notification) {
    return next(new NotFoundError('Notification not found'));
  }

  // Can only delete draft or failed notifications
  if (!['draft', 'failed'].includes(notification.status)) {
    return errorResponse(res, 400, 'Can only delete draft or failed notifications');
  }

  await notification.deleteOne();

  // Create audit log
  await AuditLog.log({
    tenant_id: req.tenant._id,
    user_id: req.user._id,
    action: 'notification_cancelled',
    resource_type: 'notification',
    resource_id: notification._id,
    details: {
      title: notification.title
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Notification deleted', {
    notification_id: notification._id,
    tenant_id: req.tenant._id,
    deleted_by: req.user._id
  });

  successResponse(res, 200, null, 'Notification deleted successfully');
});

// Send notification
exports.sendNotification = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!notification) {
    return next(new NotFoundError('Notification not found'));
  }

  // Can only send draft or pending notifications
  if (!['draft', 'pending'].includes(notification.status)) {
    return errorResponse(res, 400, 'Notification has already been sent or is in invalid state');
  }

  // Check if tenant has enough credits
  const targetedCount = notification.stats.total_targeted;
  if (!req.tenant.hasCredits(targetedCount)) {
    return next(new InsufficientCreditsError(
      `Insufficient credits. Required: ${targetedCount}, Available: ${req.tenant.credits.current_balance}`
    ));
  }

  // Send notification asynchronously
  // In production, this should be queued to a job queue (Bull, RabbitMQ, etc.)
  webPushService.sendNotification(notification._id)
    .then(result => {
      logger.info('Notification sent successfully', result);
    })
    .catch(error => {
      logger.error('Error sending notification', {
        notification_id: notification._id,
        error: error.message
      });
    });

  successResponse(res, 200, {
    notification_id: notification._id,
    status: 'sending',
    message: 'Notification is being sent'
  }, 'Notification sending initiated');
});

// Get notification logs
exports.getLogs = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 50,
    status
  } = req.query;

  const notification = await Notification.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!notification) {
    return next(new NotFoundError('Notification not found'));
  }

  const query = { notification_id: notification._id };

  if (status) {
    query.status = status;
  }

  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    NotificationLog.find(query)
      .populate('customer_id', 'customer_identifier tags')
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean(),
    NotificationLog.countDocuments(query)
  ]);

  paginatedResponse(res, 200, logs, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});

// Get notification statistics
exports.getStats = asyncHandler(async (req, res, next) => {
  const tenantId = req.tenant._id;

  // Get current month start
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Get overall stats
  const [
    totalSent,
    sentThisMonth,
    totalDraft,
    totalFailed
  ] = await Promise.all([
    Notification.countDocuments({
      tenant_id: tenantId,
      status: 'sent'
    }),
    Notification.countDocuments({
      tenant_id: tenantId,
      status: 'sent',
      sent_at: { $gte: monthStart }
    }),
    Notification.countDocuments({
      tenant_id: tenantId,
      status: 'draft'
    }),
    Notification.countDocuments({
      tenant_id: tenantId,
      status: 'failed'
    })
  ]);

  // Get delivery stats
  const deliveryStats = await Notification.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        status: 'sent'
      }
    },
    {
      $group: {
        _id: null,
        total_targeted: { $sum: '$stats.total_targeted' },
        total_sent: { $sum: '$stats.total_sent' },
        total_delivered: { $sum: '$stats.total_delivered' },
        total_failed: { $sum: '$stats.total_failed' },
        total_clicked: { $sum: '$stats.total_clicked' },
        total_credits_consumed: { $sum: '$stats.credits_consumed' }
      }
    }
  ]);

  const stats = deliveryStats[0] || {
    total_targeted: 0,
    total_sent: 0,
    total_delivered: 0,
    total_failed: 0,
    total_clicked: 0,
    total_credits_consumed: 0
  };

  // Calculate rates
  const deliveryRate = stats.total_sent > 0
    ? ((stats.total_delivered / stats.total_sent) * 100).toFixed(2)
    : 0;

  const clickRate = stats.total_delivered > 0
    ? ((stats.total_clicked / stats.total_delivered) * 100).toFixed(2)
    : 0;

  const failureRate = stats.total_sent > 0
    ? ((stats.total_failed / stats.total_sent) * 100).toFixed(2)
    : 0;

  // Get recent notifications
  const recentNotifications = await Notification.find({
    tenant_id: tenantId,
    status: 'sent'
  })
    .sort({ sent_at: -1 })
    .limit(5)
    .select('title sent_at stats')
    .lean();

  // Get performance by day (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const performanceByDay = await Notification.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        status: 'sent',
        sent_at: { $gte: thirtyDaysAgo }
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
        delivered: { $sum: '$stats.total_delivered' },
        clicked: { $sum: '$stats.total_clicked' }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);

  const statsData = {
    overview: {
      total_sent: totalSent,
      sent_this_month: sentThisMonth,
      total_draft: totalDraft,
      total_failed: totalFailed
    },
    performance: {
      total_targeted: stats.total_targeted,
      total_sent: stats.total_sent,
      total_delivered: stats.total_delivered,
      total_failed: stats.total_failed,
      total_clicked: stats.total_clicked,
      delivery_rate: parseFloat(deliveryRate),
      click_rate: parseFloat(clickRate),
      failure_rate: parseFloat(failureRate),
      total_credits_consumed: stats.total_credits_consumed
    },
    recent_notifications: recentNotifications,
    performance_by_day: performanceByDay.map(day => ({
      date: day._id,
      count: day.count,
      delivered: day.delivered,
      clicked: day.clicked
    }))
  };

  successResponse(res, 200, statsData);
});

// Cancel scheduled notification
exports.cancelNotification = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!notification) {
    return next(new NotFoundError('Notification not found'));
  }

  if (notification.status !== 'pending') {
    return errorResponse(res, 400, 'Can only cancel pending notifications');
  }

  notification.status = 'cancelled';
  notification.schedule.status = 'cancelled';
  await notification.save();

  // Create audit log
  await AuditLog.log({
    tenant_id: req.tenant._id,
    user_id: req.user._id,
    action: 'notification_cancelled',
    resource_type: 'notification',
    resource_id: notification._id,
    details: {
      title: notification.title,
      was_scheduled_for: notification.schedule.scheduled_for
    },
    metadata: {
      ip_address: req.ip,
      user_agent: req.get('user-agent')
    },
    severity: 'info'
  });

  logger.info('Notification cancelled', {
    notification_id: notification._id,
    tenant_id: req.tenant._id,
    cancelled_by: req.user._id
  });

  successResponse(res, 200, notification, 'Notification cancelled successfully');
});

// Retry failed notification
exports.retryNotification = asyncHandler(async (req, res, next) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    tenant_id: req.tenant._id
  });

  if (!notification) {
    return next(new NotFoundError('Notification not found'));
  }

  if (notification.status !== 'failed') {
    return errorResponse(res, 400, 'Can only retry failed notifications');
  }

  // Reset status
  notification.status = 'pending';
  notification.error_message = undefined;
  await notification.save();

  // Send notification
  webPushService.sendNotification(notification._id)
    .then(result => {
      logger.info('Notification retry initiated', result);
    })
    .catch(error => {
      logger.error('Error retrying notification', {
        notification_id: notification._id,
        error: error.message
      });
    });

  successResponse(res, 200, notification, 'Notification retry initiated');
});

// Track notification delivered (Public endpoint)
exports.trackDelivered = asyncHandler(async (req, res, next) => {
  const { notificationId } = req.params;
  const { customer_id } = req.body;

  logger.info('Delivery tracking request received', {
    notification_id: notificationId,
    customer_id: customer_id
  });

  const notification = await Notification.findById(notificationId);

  if (!notification) {
    logger.warn('Notification not found for delivery tracking', {
      notification_id: notificationId
    });
    return successResponse(res, 200, null, 'Tracking recorded');
  }

  // Update NotificationLog if customer_id is provided
  let shouldIncrementCount = false;

  if (customer_id) {
    const notificationLog = await NotificationLog.findOne({
      notification_id: notificationId,
      customer_id: customer_id
    });

    if (notificationLog && notificationLog.status === 'sent') {
      await notificationLog.markAsDelivered(200);
      shouldIncrementCount = true;
      logger.info('NotificationLog marked as delivered', {
        notification_id: notificationId,
        customer_id: customer_id
      });
    } else if (notificationLog) {
      logger.info('NotificationLog already in status', {
        notification_id: notificationId,
        customer_id: customer_id,
        current_status: notificationLog.status
      });
    } else {
      logger.warn('NotificationLog not found', {
        notification_id: notificationId,
        customer_id: customer_id
      });
    }
  } else {
    // If no customer_id, increment anyway (backward compatibility)
    shouldIncrementCount = true;
  }

  // Only increment delivered count if NotificationLog was updated
  if (shouldIncrementCount) {
    notification.stats.total_delivered = (notification.stats.total_delivered || 0) + 1;
    await notification.save();
    logger.info('Notification delivered count incremented', {
      notification_id: notificationId,
      total_delivered: notification.stats.total_delivered
    });
  }

  successResponse(res, 200, null, 'Delivery tracked');
});

// Track notification clicked (Public endpoint)
exports.trackClicked = asyncHandler(async (req, res, next) => {
  const { notificationId } = req.params;
  const { customer_id } = req.body;

  logger.info('Click tracking request received', {
    notification_id: notificationId,
    customer_id: customer_id,
    body: req.body
  });

  const notification = await Notification.findById(notificationId);

  if (!notification) {
    logger.warn('Notification not found for click tracking', {
      notification_id: notificationId
    });
    return successResponse(res, 200, null, 'Tracking recorded');
  }

  // Update NotificationLog if customer_id is provided
  let shouldIncrementCount = false;

  if (customer_id) {
    const notificationLog = await NotificationLog.findOne({
      notification_id: notificationId,
      customer_id: customer_id
    });

    if (notificationLog && notificationLog.status !== 'clicked') {
      await notificationLog.markAsClicked();
      shouldIncrementCount = true;
      logger.info('NotificationLog marked as clicked', {
        notification_id: notificationId,
        customer_id: customer_id,
        previous_status: notificationLog.status
      });
    } else if (notificationLog && notificationLog.status === 'clicked') {
      logger.info('NotificationLog already marked as clicked (duplicate)', {
        notification_id: notificationId,
        customer_id: customer_id
      });
    } else {
      logger.warn('NotificationLog not found for click tracking', {
        notification_id: notificationId,
        customer_id: customer_id
      });
    }
  } else {
    logger.warn('No customer_id provided for click tracking', {
      notification_id: notificationId
    });
    // If no customer_id, increment anyway (backward compatibility)
    shouldIncrementCount = true;
  }

  // Only increment clicked count if NotificationLog was updated
  if (shouldIncrementCount) {
    notification.stats.total_clicked = (notification.stats.total_clicked || 0) + 1;
    await notification.save();
    logger.info('Notification clicked count incremented', {
      notification_id: notificationId,
      total_clicked: notification.stats.total_clicked
    });
  }

  successResponse(res, 200, null, 'Click tracked');
});
