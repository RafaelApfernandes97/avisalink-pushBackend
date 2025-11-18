const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema({
  tenant_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  notification_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Notification',
    required: true,
    index: true
  },
  customer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'failed', 'clicked'],
    default: 'pending',
    index: true
  },
  delivery_details: {
    endpoint: String,
    status_code: Number,
    response_message: String,
    retry_count: {
      type: Number,
      default: 0
    },
    sent_at: Date,
    delivered_at: Date,
    clicked_at: Date
  },
  error: {
    code: String,
    message: String,
    stack: String
  },
  metadata: {
    user_agent: String,
    ip_address: String,
    browser: String,
    os: String
  },
  created_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Compound indexes for queries
notificationLogSchema.index({ tenant_id: 1, created_at: -1 });
notificationLogSchema.index({ notification_id: 1, status: 1 });
notificationLogSchema.index({ customer_id: 1, created_at: -1 });

// TTL index to automatically delete logs older than 90 days
notificationLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

// Method to mark as sent
notificationLogSchema.methods.markAsSent = async function() {
  this.status = 'sent';
  this.delivery_details.sent_at = new Date();
  return await this.save();
};

// Method to mark as delivered
notificationLogSchema.methods.markAsDelivered = async function(statusCode) {
  this.status = 'delivered';
  this.delivery_details.status_code = statusCode;
  this.delivery_details.delivered_at = new Date();
  return await this.save();
};

// Method to mark as failed
notificationLogSchema.methods.markAsFailed = async function(error) {
  this.status = 'failed';
  this.error = {
    code: error.code || 'UNKNOWN_ERROR',
    message: error.message,
    stack: error.stack
  };
  return await this.save();
};

// Method to mark as clicked
notificationLogSchema.methods.markAsClicked = async function() {
  this.status = 'clicked';
  this.delivery_details.clicked_at = new Date();
  return await this.save();
};

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
