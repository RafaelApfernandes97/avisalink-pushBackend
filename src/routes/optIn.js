const express = require('express');
const router = express.Router();
const { optInLimiter } = require('../middleware/rateLimiter');
const { validate, schemas } = require('../middleware/validation');

// Import controller
const optInController = require('../controllers/optInController');

// Public opt-in routes (no authentication required)
router.use(optInLimiter);

// Get opt-in page details
router.get('/:token', optInController.getOptInPage);

// Submit opt-in (customer subscribes)
router.post('/:token', validate(schemas.customerOptIn), optInController.submitOptIn);

// Unsubscribe
router.post('/:token/unsubscribe', optInController.unsubscribe);

module.exports = router;
