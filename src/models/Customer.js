const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  tenant_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  subscription: {
    endpoint: {
      type: String,
      required: false
    },
    keys: {
      p256dh: {
        type: String,
        required: false
      },
      auth: {
        type: String,
        required: false
      }
    }
  },
  opt_in_token: {
    type: String,
    index: true
  },
  opt_in_status: {
    type: String,
    enum: ['pending', 'active', 'unsubscribed', 'expired'],
    default: 'pending',
    index: true
  },
  opt_in_date: {
    type: Date
  },
  opt_in_metadata: {
    ip_address: String,
    user_agent: String,
    browser: String,
    os: String,
    device_type: String,
    referrer: String
  },
  unsubscribe_date: {
    type: Date
  },
  unsubscribe_reason: {
    type: String
  },
  customer_identifier: {
    type: String,
    index: true
  },
  name: {
    type: String,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    index: true
  },
  phone: {
    type: String,
    trim: true,
    maxlength: 20
  },
  tags: [{
    type: String,
    trim: true
  }],
  custom_data: {
    type: Map,
    of: String
  },
  notification_stats: {
    total_sent: {
      type: Number,
      default: 0
    },
    total_delivered: {
      type: Number,
      default: 0
    },
    total_failed: {
      type: Number,
      default: 0
    },
    total_clicked: {
      type: Number,
      default: 0
    },
    last_notification_date: Date
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Compound indexes for queries
customerSchema.index({ tenant_id: 1, opt_in_status: 1 });
customerSchema.index({ tenant_id: 1, customer_identifier: 1 });
customerSchema.index({ tenant_id: 1, email: 1 });
customerSchema.index({ tenant_id: 1, tags: 1 });
customerSchema.index({ 'subscription.endpoint': 1 }, { unique: true, sparse: true });

// Note: opt_in_token is provided from the opt-in link when customer subscribes
// It's not auto-generated to maintain the relationship with the opt-in link

// Method to activate opt-in
customerSchema.methods.activateOptIn = async function(metadata = {}) {
  this.opt_in_status = 'active';
  this.opt_in_date = new Date();
  this.opt_in_metadata = {
    ...this.opt_in_metadata,
    ...metadata
  };

  return await this.save();
};

// Method to unsubscribe
customerSchema.methods.unsubscribe = async function(reason) {
  this.opt_in_status = 'unsubscribed';
  this.unsubscribe_date = new Date();
  this.unsubscribe_reason = reason;

  return await this.save();
};

// Method to update notification stats
customerSchema.methods.updateNotificationStats = async function(status) {
  this.notification_stats.total_sent += 1;
  this.notification_stats.last_notification_date = new Date();

  if (status === 'delivered') {
    this.notification_stats.total_delivered += 1;
  } else if (status === 'failed') {
    this.notification_stats.total_failed += 1;
  }

  return await this.save();
};

// Method to increment click count
customerSchema.methods.incrementClickCount = async function() {
  this.notification_stats.total_clicked += 1;
  return await this.save();
};

// Method to check if opt-in is active
customerSchema.methods.isActiveOptIn = function() {
  return this.opt_in_status === 'active';
};

module.exports = mongoose.model('Customer', customerSchema);
