const express = require('express');
const router = express.Router();
const { protect, authorize, checkPermission } = require('../middleware/auth');
const { tenantReadLimiter, notificationLimiter } = require('../middleware/rateLimiter');
const { validate, schemas } = require('../middleware/validation');

// Import controllers
const userController = require('../controllers/userController');
const customerController = require('../controllers/customerController');
const notificationController = require('../controllers/notificationController');
const optInLinkController = require('../controllers/optInLinkController');
const tenantController = require('../controllers/tenantController');
const creditController = require('../controllers/creditController');

// All tenant routes require authentication
router.use(protect);
router.use(authorize('tenant_admin', 'operator'));
router.use(tenantReadLimiter);

// Tenant dashboard and settings
router.get('/dashboard', tenantController.getDashboard);
router.get('/settings', tenantController.getSettings);
router.put('/settings', authorize('tenant_admin'), tenantController.updateSettings);

// Credit information
router.get('/credits', creditController.getBalance);
router.get('/credits/usage', creditController.getUsage);
router.get('/credits/transactions', creditController.getTransactions);
router.post('/credits/request', creditController.requestCredits);
router.get('/credits/history', creditController.getHistory);
router.get('/credits/stats', creditController.getStats);
router.get('/credits/report', creditController.getUsageReport);

// User management
router.route('/users')
  .get(checkPermission('manage_users'), userController.getUsers)
  .post(checkPermission('manage_users'), validate(schemas.createUser), userController.createUser);

router.route('/users/:id')
  .get(userController.getUser)
  .put(checkPermission('manage_users'), validate(schemas.updateUser), userController.updateUser)
  .delete(checkPermission('manage_users'), userController.deleteUser);

router.get('/users/:id/activity', userController.getUserActivity);
router.post('/users/:id/reset-password', checkPermission('manage_users'), userController.resetUserPassword);
router.post('/users/:id/unlock', checkPermission('manage_users'), userController.unlockUser);

// Customer management
router.route('/customers')
  .get(checkPermission('manage_opt_ins'), customerController.getCustomers);

router.get('/customers/stats', checkPermission('view_analytics'), customerController.getStats);
router.post('/customers/import', checkPermission('manage_opt_ins'), customerController.bulkImport);
router.get('/customers/export', checkPermission('manage_opt_ins'), customerController.exportCustomers);

router.route('/customers/:id')
  .get(checkPermission('manage_opt_ins'), customerController.getCustomer)
  .put(checkPermission('manage_opt_ins'), customerController.updateCustomer)
  .delete(checkPermission('manage_opt_ins'), customerController.deleteCustomer);

router.get('/customers/:id/notifications', checkPermission('view_analytics'), customerController.getCustomerNotifications);

// Opt-in link management
router.route('/opt-in-links')
  .get(checkPermission('manage_opt_ins'), optInLinkController.getLinks)
  .post(checkPermission('manage_opt_ins'), validate(schemas.createOptInLink), optInLinkController.createLink);

router.route('/opt-in-links/:id')
  .get(checkPermission('manage_opt_ins'), optInLinkController.getLink)
  .put(checkPermission('manage_opt_ins'), optInLinkController.updateLink)
  .delete(checkPermission('manage_opt_ins'), optInLinkController.deleteLink);

router.get('/opt-in-links/:id/stats', checkPermission('view_analytics'), optInLinkController.getLinkStats);
router.post('/opt-in-links/:id/regenerate-token', checkPermission('manage_opt_ins'), optInLinkController.regenerateToken);

// Notification management
router.route('/notifications')
  .get(checkPermission('view_analytics'), notificationController.getNotifications)
  .post(checkPermission('send_notifications'), notificationLimiter, validate(schemas.createNotification), notificationController.createNotification);

router.get('/notifications/stats', checkPermission('view_analytics'), notificationController.getStats);

router.route('/notifications/:id')
  .get(checkPermission('view_analytics'), notificationController.getNotification)
  .put(checkPermission('send_notifications'), notificationController.updateNotification)
  .delete(checkPermission('send_notifications'), notificationController.deleteNotification);

router.post('/notifications/:id/send', checkPermission('send_notifications'), notificationLimiter, notificationController.sendNotification);
router.post('/notifications/:id/cancel', checkPermission('send_notifications'), notificationController.cancelNotification);
router.post('/notifications/:id/retry', checkPermission('send_notifications'), notificationController.retryNotification);
router.get('/notifications/:id/logs', checkPermission('view_analytics'), notificationController.getLogs);

module.exports = router;
