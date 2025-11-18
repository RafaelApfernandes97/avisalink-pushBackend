const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const optInLinkSchema = new mongoose.Schema({
  tenant_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  token: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Link name is required'],
    trim: true,
    maxlength: [100, 'Link name cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'expired'],
    default: 'active',
    index: true
  },
  expiry_date: {
    type: Date
  },
  customization: {
    company_name: {
      type: String,
      default: 'Sua Empresa'
    },
    page_title: {
      type: String,
      default: 'Receba Notificações'
    },
    page_description: {
      type: String,
      default: 'Fique por dentro das novidades e atualizações'
    },
    button_text: {
      type: String,
      default: 'Permitir Notificações'
    },
    success_message: {
      type: String,
      default: 'Obrigado por se inscrever!'
    },
    logo_url: String,
    primary_color: {
      type: String,
      default: '#1976d2'
    },
    secondary_color: {
      type: String,
      default: '#424242'
    },
    background_color: {
      type: String,
      default: '#ffffff'
    },
    text_color: {
      type: String,
      default: '#000000'
    },
    button_text_color: {
      type: String,
      default: '#ffffff'
    }
  },
  form_fields: {
    require_name: {
      type: Boolean,
      default: true
    },
    require_email: {
      type: Boolean,
      default: true
    },
    require_phone: {
      type: Boolean,
      default: false
    },
    custom_fields: [{
      label: String,
      field_name: String,
      type: {
        type: String,
        enum: ['text', 'email', 'phone', 'select', 'checkbox'],
        default: 'text'
      },
      required: {
        type: Boolean,
        default: false
      },
      options: [String] // Para campos do tipo select
    }]
  },
  targeting: {
    tags: [{
      type: String,
      trim: true
    }],
    allowed_domains: [{
      type: String,
      trim: true
    }],
    max_subscriptions: Number
  },
  stats: {
    total_views: {
      type: Number,
      default: 0
    },
    total_subscriptions: {
      type: Number,
      default: 0
    },
    conversion_rate: {
      type: Number,
      default: 0
    },
    last_used_date: Date
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
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
optInLinkSchema.index({ tenant_id: 1, status: 1 });
optInLinkSchema.index({ expiry_date: 1 });

// Generate unique token before saving
optInLinkSchema.pre('save', function(next) {
  if (this.isNew && !this.token) {
    this.token = uuidv4();
  }
  next();
});

// Method to check if link is expired
optInLinkSchema.methods.isExpired = function() {
  if (!this.expiry_date) {
    return false;
  }
  return this.expiry_date < new Date();
};

// Method to check if link is active
optInLinkSchema.methods.isActive = function() {
  return this.status === 'active' && !this.isExpired();
};

// Method to increment view count
optInLinkSchema.methods.incrementViewCount = async function() {
  this.stats.total_views += 1;
  this.stats.last_used_date = new Date();
  return await this.save();
};

// Method to increment subscription count
optInLinkSchema.methods.incrementSubscriptionCount = async function() {
  this.stats.total_subscriptions += 1;
  this.stats.last_used_date = new Date();

  // Calculate conversion rate
  if (this.stats.total_views > 0) {
    this.stats.conversion_rate = (this.stats.total_subscriptions / this.stats.total_views) * 100;
  }

  return await this.save();
};

// Method to check if max subscriptions reached
optInLinkSchema.methods.hasReachedMaxSubscriptions = function() {
  if (!this.targeting.max_subscriptions) {
    return false;
  }
  return this.stats.total_subscriptions >= this.targeting.max_subscriptions;
};

module.exports = mongoose.model('OptInLink', optInLinkSchema);
