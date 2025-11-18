const express = require('express');
const router = express.Router();
const webPushService = require('../services/webPushService');
const notificationController = require('../controllers/notificationController');

// Get VAPID public key (needed for client-side push subscription)
router.get('/vapid', (req, res) => {
  const publicKey = webPushService.getVapidPublicKey();

  res.json({
    success: true,
    data: {
      vapid_public_key: publicKey
    }
  });
});

// Track notification delivered/viewed
router.post('/notifications/:notificationId/delivered', notificationController.trackDelivered);

// Track notification click
router.post('/notifications/:notificationId/clicked', notificationController.trackClicked);

module.exports = router;
