const webPush = require('web-push');
const Customer = require('../models/Customer');
const Notification = require('../models/Notification');
const NotificationLog = require('../models/NotificationLog');
const Tenant = require('../models/Tenant');
const AuditLog = require('../models/AuditLog');
const CreditTransaction = require('../models/CreditTransaction');
const logger = require('../utils/logger');

// Configure web-push with VAPID keys
webPush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:example@yourdomain.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

class WebPushService {
  // Send notification to a single customer
  async sendToCustomer(customer, notificationData, notificationId, tenantId) {
    try {
      const payload = JSON.stringify({
        title: notificationData.title,
        message: notificationData.message,
        body: notificationData.message,
        icon: notificationData.icon_url || '/logo.png',
        badge: notificationData.badge_url || '/badge.png',
        image: notificationData.image_url,
        url: notificationData.action_url || '/',
        action_url: notificationData.action_url || '/',
        notification_id: notificationId,
        notificationId: notificationId,
        customer_id: customer._id.toString(),
        tenant_id: tenantId,
        actions: notificationData.actions || [],
        data: {
          url: notificationData.action_url || '/',
          notification_id: notificationId,
          customer_id: customer._id.toString(),
          tenant_id: tenantId
        }
      });

      logger.info('Sending push notification', {
        notification_id: notificationId,
        customer_id: customer._id,
        action_url: notificationData.action_url,
        payload_preview: payload.substring(0, 200)
      });

      const options = {
        TTL: 86400, // 24 hours
        vapidDetails: {
          subject: process.env.VAPID_SUBJECT,
          publicKey: process.env.VAPID_PUBLIC_KEY,
          privateKey: process.env.VAPID_PRIVATE_KEY
        }
      };

      // Create notification log
      const notificationLog = await NotificationLog.create({
        tenant_id: tenantId,
        notification_id: notificationId,
        customer_id: customer._id,
        status: 'pending',
        delivery_details: {
          endpoint: customer.subscription.endpoint
        }
      });

      try {
        // Send push notification
        const response = await webPush.sendNotification(
          customer.subscription,
          payload,
          options
        );

        // Mark as sent (not delivered yet - that happens when service worker shows it)
        await notificationLog.markAsSent();
        await customer.updateNotificationStats('delivered');

        logger.info('Push notification sent successfully', {
          customer_id: customer._id,
          notification_id: notificationId,
          status_code: response.statusCode
        });

        return { success: true, customer_id: customer._id };
      } catch (error) {
        // Handle subscription errors (expired, invalid, etc.)
        if (error.statusCode === 410 || error.statusCode === 404) {
          // Subscription expired or invalid - mark as unsubscribed
          await customer.unsubscribe('Subscription expired or invalid');
          logger.warn('Subscription expired or invalid', {
            customer_id: customer._id,
            error: error.message
          });
        }

        // Mark as failed
        await notificationLog.markAsFailed(error);
        await customer.updateNotificationStats('failed');

        logger.error('Failed to send push notification', {
          customer_id: customer._id,
          notification_id: notificationId,
          error: error.message
        });

        return { success: false, customer_id: customer._id, error: error.message };
      }
    } catch (error) {
      logger.error('Error in sendToCustomer', {
        customer_id: customer._id,
        error: error.message
      });

      return { success: false, customer_id: customer._id, error: error.message };
    }
  }

  // Send notification to multiple customers
  async sendNotification(notificationId) {
    try {
      const notification = await Notification.findById(notificationId);

      if (!notification) {
        throw new Error('Notification not found');
      }

      // Get tenant
      const tenant = await Tenant.findById(notification.tenant_id);

      if (!tenant) {
        throw new Error('Tenant not found');
      }

      // Get target customers
      let customers = [];

      if (notification.targeting.send_to_all) {
        // Send to all active opt-ins
        customers = await Customer.find({
          tenant_id: tenant._id,
          opt_in_status: 'active'
        });
      } else if (notification.targeting.customer_ids && notification.targeting.customer_ids.length > 0) {
        // Send to specific customers
        customers = await Customer.find({
          _id: { $in: notification.targeting.customer_ids },
          tenant_id: tenant._id,
          opt_in_status: 'active'
        });
      } else if (notification.targeting.tags && notification.targeting.tags.length > 0) {
        // Send to customers with specific tags
        customers = await Customer.find({
          tenant_id: tenant._id,
          opt_in_status: 'active',
          tags: { $in: notification.targeting.tags }
        });
      }

      if (customers.length === 0) {
        await notification.markAsFailed('No active customers found');
        return {
          success: false,
          message: 'No active customers found'
        };
      }

      // Check if tenant has enough credits
      if (!tenant.hasCredits(customers.length)) {
        await notification.markAsFailed('Insufficient credits');

        await AuditLog.log({
          tenant_id: tenant._id,
          user_id: notification.created_by,
          action: 'notification_failed',
          resource_type: 'notification',
          resource_id: notification._id,
          details: {
            reason: 'Insufficient credits',
            required: customers.length,
            available: tenant.credits.current_balance
          },
          severity: 'warning'
        });

        return {
          success: false,
          message: 'Insufficient credits',
          required: customers.length,
          available: tenant.credits.current_balance
        };
      }

      // Update notification status
      notification.status = 'sending';
      notification.stats.total_targeted = customers.length;
      await notification.save();

      // Send to all customers
      const results = await Promise.allSettled(
        customers.map(customer =>
          this.sendToCustomer(customer, notification, notification._id, tenant._id)
        )
      );

      // Aggregate results
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.filter(r => r.status === 'fulfilled' && !r.value.success).length;

      // Consume credits (only for successful sends)
      await tenant.consumeCredits(successful);

      // Record credit transaction
      await CreditTransaction.createTransaction({
        tenant_id: tenant._id,
        type: 'consumption',
        amount: -successful,
        balance_before: tenant.credits.current_balance + successful,
        balance_after: tenant.credits.current_balance,
        description: `Notification sent: ${notification.title}`,
        reference: 'notification',
        reference_id: notification._id,
        performed_by: notification.created_by,
        metadata: {
          notification_count: successful
        }
      });

      // Update notification stats
      await notification.updateStats({
        total_sent: successful + failed,
        total_delivered: successful,
        total_failed: failed,
        credits_consumed: successful
      });

      await notification.markAsSent();

      // Create audit log
      await AuditLog.log({
        tenant_id: tenant._id,
        user_id: notification.created_by,
        action: 'notification_sent',
        resource_type: 'notification',
        resource_id: notification._id,
        details: {
          title: notification.title,
          targeted: customers.length,
          sent: successful + failed,
          delivered: successful,
          failed: failed,
          credits_consumed: successful
        },
        severity: 'info'
      });

      logger.info('Notification batch sent', {
        notification_id: notification._id,
        tenant_id: tenant._id,
        targeted: customers.length,
        successful,
        failed
      });

      return {
        success: true,
        notification_id: notification._id,
        stats: {
          targeted: customers.length,
          sent: successful + failed,
          delivered: successful,
          failed: failed,
          credits_consumed: successful
        }
      };
    } catch (error) {
      logger.error('Error sending notification', {
        notification_id: notificationId,
        error: error.message
      });

      throw error;
    }
  }

  // Get VAPID public key
  getVapidPublicKey() {
    return process.env.VAPID_PUBLIC_KEY;
  }
}

module.exports = new WebPushService();
