const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { authLimiter } = require('../middleware/rateLimiter');

// Public routes (with rate limiting)
router.post('/register', authLimiter, validate(schemas.createUser), authController.register);
router.post('/login', authLimiter, validate(schemas.login), authController.login);

// Protected routes
router.get('/me', protect, authController.getMe);
router.put('/change-password', protect, validate(schemas.changePassword), authController.changePassword);
router.post('/logout', protect, authController.logout);

module.exports = router;
