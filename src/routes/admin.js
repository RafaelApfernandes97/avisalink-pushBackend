const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { apiLimiter, tenantCreationLimiter } = require('../middleware/rateLimiter');
const { validate, schemas } = require('../middleware/validation');

// Import controllers
const tenantController = require('../controllers/tenantController');
const creditController = require('../controllers/creditController');
const adminController = require('../controllers/adminController');
const userController = require('../controllers/userController');

// All admin routes require global_admin role
router.use(protect);
router.use(authorize('global_admin'));
router.use(apiLimiter);

// Dashboard and metrics
router.get('/dashboard', adminController.getDashboard);
router.get('/metrics', adminController.getGlobalMetrics);
router.get('/health', adminController.getSystemHealth);
router.get('/performance', adminController.getTenantPerformance);
router.get('/top-tenants', adminController.getTopTenants);

// Audit logs
router.get('/audit-logs', adminController.getAuditLogs);
router.get('/audit-logs/critical', adminController.getCriticalLogs);

// Tenant management
router.route('/tenants')
  .get(tenantController.getAllTenants)
  .post(tenantCreationLimiter, validate(schemas.createTenant), tenantController.createTenant);

router.route('/tenants/:id')
  .get(tenantController.getTenant)
  .put(validate(schemas.updateTenant), tenantController.updateTenant)
  .delete(tenantController.deleteTenant);

router.post('/tenants/:id/suspend', tenantController.suspendTenant);
router.post('/tenants/:id/activate', tenantController.activateTenant);

// Credit management
router.post('/tenants/:id/credits', validate(schemas.addCredits), creditController.addCredits);
router.put('/tenants/:id/limit', creditController.updateLimit);
router.post('/tenants/:id/credits/adjust', creditController.adjustCredits);

// User management (Global Admin)
router.route('/users')
  .get(adminController.getAllUsers)
  .post(validate(schemas.createUser), adminController.createUserForTenant);

router.route('/users/:id')
  .put(validate(schemas.updateUser), adminController.updateUserByAdmin)
  .delete(adminController.deleteUserByAdmin);

router.post('/users/:id/unlock', userController.unlockUser);

module.exports = router;
