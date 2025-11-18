const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Tenant name is required'],
    trim: true,
    maxlength: [100, 'Tenant name cannot exceed 100 characters']
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'inactive'],
    default: 'active'
  },
  credits: {
    monthly_limit: {
      type: Number,
      default: 100,
      min: [0, 'Monthly limit cannot be negative']
    },
    current_balance: {
      type: Number,
      default: 100,
      min: [0, 'Credit balance cannot be negative']
    },
    used_this_month: {
      type: Number,
      default: 0,
      min: [0, 'Used credits cannot be negative']
    },
    last_reset_date: {
      type: Date,
      default: Date.now
    },
    rollover_enabled: {
      type: Boolean,
      default: true
    },
    rollover_balance: {
      type: Number,
      default: 0,
      min: [0, 'Rollover balance cannot be negative']
    }
  },
  settings: {
    timezone: {
      type: String,
      default: 'UTC'
    },
    opt_in_link_expiry_days: {
      type: Number,
      default: 30
    },
    notification_defaults: {
      icon_url: String,
      badge_url: String
    }
  },
  metadata: {
    industry: String,
    company_size: String,
    website: String,
    phone: String,
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      postal_code: String
    }
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

// Indexes for performance
tenantSchema.index({ status: 1, created_at: -1 });
tenantSchema.index({ 'credits.current_balance': 1 });

// Generate slug from name before saving
tenantSchema.pre('save', function(next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  next();
});

// Method to check if tenant has enough credits
tenantSchema.methods.hasCredits = function(amount = 1) {
  return this.credits.current_balance >= amount;
};

// Method to consume credits
tenantSchema.methods.consumeCredits = async function(amount = 1) {
  if (!this.hasCredits(amount)) {
    throw new Error('Insufficient credits');
  }

  this.credits.current_balance -= amount;
  this.credits.used_this_month += amount;

  return await this.save();
};

// Method to add credits (recharge)
tenantSchema.methods.addCredits = async function(amount) {
  this.credits.current_balance += amount;
  return await this.save();
};

// Method to reset monthly credits
tenantSchema.methods.resetMonthlyCredits = async function() {
  const currentBalance = this.credits.current_balance;
  const monthlyLimit = this.credits.monthly_limit;

  // Handle rollover if enabled
  if (this.credits.rollover_enabled) {
    this.credits.rollover_balance = currentBalance;
    this.credits.current_balance = monthlyLimit + currentBalance;
  } else {
    this.credits.current_balance = monthlyLimit;
    this.credits.rollover_balance = 0;
  }

  this.credits.used_this_month = 0;
  this.credits.last_reset_date = new Date();

  return await this.save();
};

module.exports = mongoose.model('Tenant', tenantSchema);
