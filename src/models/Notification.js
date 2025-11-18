const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  tenant_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: [true, 'Notification title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  message: {
    type: String,
    required: [true, 'Notification message is required'],
    trim: true,
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  image_url: {
    type: String,
    trim: true
  },
  icon_url: {
    type: String,
    trim: true
  },
  badge_url: {
    type: String,
    trim: true
  },
  action_url: {
    type: String,
    trim: true
  },
  actions: [{
    action: {
      type: String,
      required: true
    },
    title: {
      type: String,
      required: true
    },
    icon: String
  }],
  targeting: {
    customer_ids: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer'
    }],
    tags: [{
      type: String,
      trim: true
    }],
    send_to_all: {
      type: Boolean,
      default: false
    }
  },
  schedule: {
    scheduled_for: Date,
    timezone: String,
    status: {
      type: String,
      enum: ['immediate', 'scheduled', 'sent', 'cancelled'],
      default: 'immediate'
    }
  },
  stats: {
    total_targeted: {
      type: Number,
      default: 0
    },
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
    credits_consumed: {
      type: Number,
      default: 0
    }
  },
  status: {
    type: String,
    enum: ['draft', 'pending', 'sending', 'sent', 'failed', 'cancelled'],
    default: 'draft',
    index: true
  },
  error_message: {
    type: String
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sent_at: {
    type: Date
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

// Indexes
notificationSchema.index({ tenant_id: 1, status: 1 });
notificationSchema.index({ tenant_id: 1, created_at: -1 });
notificationSchema.index({ 'schedule.scheduled_for': 1, 'schedule.status': 1 });

// Method to update stats
notificationSchema.methods.updateStats = async function(updates) {
  Object.assign(this.stats, updates);
  return await this.save();
};

// Method to mark as sent
notificationSchema.methods.markAsSent = async function() {
  this.status = 'sent';
  this.sent_at = new Date();
  return await this.save();
};

// Method to mark as failed
notificationSchema.methods.markAsFailed = async function(errorMessage) {
  this.status = 'failed';
  this.error_message = errorMessage;
  return await this.save();
};

// Method to calculate delivery rate
notificationSchema.methods.getDeliveryRate = function() {
  if (this.stats.total_sent === 0) {
    return 0;
  }
  return (this.stats.total_delivered / this.stats.total_sent) * 100;
};

// Method to calculate click-through rate
notificationSchema.methods.getClickThroughRate = function() {
  if (this.stats.total_delivered === 0) {
    return 0;
  }
  return (this.stats.total_clicked / this.stats.total_delivered) * 100;
};

module.exports = mongoose.model('Notification', notificationSchema);
