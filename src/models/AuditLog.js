const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  tenant_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  action: {
    type: String,
    required: true,
    index: true,
    enum: [
      // Tenant actions
      'tenant_created',
      'tenant_updated',
      'tenant_deleted',
      'tenant_suspended',
      'tenant_activated',

      // User actions
      'user_created',
      'user_updated',
      'user_deleted',
      'user_login',
      'user_login_failed',
      'user_logout',
      'user_locked',

      // Customer actions
      'customer_opted_in',
      'customer_unsubscribed',
      'customer_updated',

      // Notification actions
      'notification_created',
      'notification_sent',
      'notification_failed',
      'notification_cancelled',

      // Credit actions
      'credits_added',
      'credits_consumed',
      'credits_reset',
      'credit_limit_updated',

      // Opt-in link actions
      'opt_in_link_created',
      'opt_in_link_updated',
      'opt_in_link_deleted',

      // System actions
      'system_error',
      'settings_updated',
      'api_key_created',
      'api_key_revoked'
    ]
  },
  resource_type: {
    type: String,
    index: true,
    enum: ['tenant', 'user', 'customer', 'notification', 'opt_in_link', 'credit', 'system']
  },
  resource_id: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  changes: {
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed
  },
  metadata: {
    ip_address: String,
    user_agent: String,
    request_id: String,
    session_id: String
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'error', 'critical'],
    default: 'info',
    index: true
  },
  created_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Compound indexes for common queries
auditLogSchema.index({ tenant_id: 1, created_at: -1 });
auditLogSchema.index({ user_id: 1, created_at: -1 });
auditLogSchema.index({ action: 1, created_at: -1 });
auditLogSchema.index({ resource_type: 1, resource_id: 1, created_at: -1 });
auditLogSchema.index({ severity: 1, created_at: -1 });

// TTL index to automatically delete logs older than 1 year
auditLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 31536000 }); // 365 days

// Static method to create audit log
auditLogSchema.statics.log = async function(logData) {
  return await this.create(logData);
};

// Static method to get logs by tenant
auditLogSchema.statics.getByTenant = async function(tenantId, options = {}) {
  const {
    limit = 100,
    skip = 0,
    action = null,
    severity = null,
    startDate = null,
    endDate = null
  } = options;

  const query = { tenant_id: tenantId };

  if (action) {
    query.action = action;
  }

  if (severity) {
    query.severity = severity;
  }

  if (startDate || endDate) {
    query.created_at = {};
    if (startDate) {
      query.created_at.$gte = new Date(startDate);
    }
    if (endDate) {
      query.created_at.$lte = new Date(endDate);
    }
  }

  return await this.find(query)
    .sort({ created_at: -1 })
    .limit(limit)
    .skip(skip)
    .populate('user_id', 'email first_name last_name')
    .lean();
};

// Static method to get logs by user
auditLogSchema.statics.getByUser = async function(userId, limit = 100) {
  return await this.find({ user_id: userId })
    .sort({ created_at: -1 })
    .limit(limit)
    .lean();
};

// Static method to get critical logs
auditLogSchema.statics.getCriticalLogs = async function(tenantId = null, limit = 100) {
  const query = { severity: { $in: ['error', 'critical'] } };

  if (tenantId) {
    query.tenant_id = tenantId;
  }

  return await this.find(query)
    .sort({ created_at: -1 })
    .limit(limit)
    .populate('tenant_id', 'name email')
    .populate('user_id', 'email first_name last_name')
    .lean();
};

module.exports = mongoose.model('AuditLog', auditLogSchema);
