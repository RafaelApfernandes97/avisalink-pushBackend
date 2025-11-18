const mongoose = require('mongoose');

const creditTransactionSchema = new mongoose.Schema({
  tenant_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['recharge', 'consumption', 'reset', 'adjustment', 'rollover', 'refund', 'request'],
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true
  },
  balance_before: {
    type: Number,
    required: false
  },
  balance_after: {
    type: Number,
    required: false
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  reference: {
    type: String,
    enum: ['notification', 'manual', 'automatic', 'system'],
    default: 'system'
  },
  reference_id: {
    type: mongoose.Schema.Types.ObjectId
  },
  performed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  metadata: {
    notification_count: Number,
    period_start: Date,
    period_end: Date,
    reason: String,
    notes: String
  },
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// Compound indexes for queries
creditTransactionSchema.index({ tenant_id: 1, created_at: -1 });
creditTransactionSchema.index({ tenant_id: 1, type: 1, created_at: -1 });

// Static method to create transaction
creditTransactionSchema.statics.createTransaction = async function(transactionData) {
  return await this.create(transactionData);
};

// Static method to get tenant transactions
creditTransactionSchema.statics.getByTenant = async function(tenantId, options = {}) {
  const {
    limit = 100,
    skip = 0,
    type = null,
    startDate = null,
    endDate = null
  } = options;

  const query = { tenant_id: tenantId };

  if (type) {
    query.type = type;
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
    .populate('performed_by', 'email first_name last_name')
    .lean();
};

// Static method to get total consumption for period
creditTransactionSchema.statics.getTotalConsumption = async function(tenantId, startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        tenant_id: mongoose.Types.ObjectId(tenantId),
        type: 'consumption',
        created_at: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' }
      }
    }
  ]);

  return result.length > 0 ? Math.abs(result[0].total) : 0;
};

// Static method to get total recharges for period
creditTransactionSchema.statics.getTotalRecharges = async function(tenantId, startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        tenant_id: mongoose.Types.ObjectId(tenantId),
        type: { $in: ['recharge', 'adjustment', 'refund'] },
        created_at: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' }
      }
    }
  ]);

  return result.length > 0 ? result[0].total : 0;
};

module.exports = mongoose.model('CreditTransaction', creditTransactionSchema);
