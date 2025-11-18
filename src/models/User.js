const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  tenant_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: function() {
      return this.role !== 'global_admin';
    },
    index: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  first_name: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  last_name: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  role: {
    type: String,
    enum: ['global_admin', 'tenant_admin', 'operator'],
    default: 'operator',
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  permissions: [{
    type: String,
    enum: [
      'manage_users',
      'send_notifications',
      'view_analytics',
      'manage_opt_ins',
      'manage_credits',
      'view_audit_logs'
    ]
  }],
  last_login: {
    type: Date
  },
  login_attempts: {
    type: Number,
    default: 0
  },
  locked_until: {
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

// Compound index to ensure unique email per tenant
userSchema.index({ email: 1, tenant_id: 1 }, { unique: true });
userSchema.index({ tenant_id: 1, role: 1 });
userSchema.index({ status: 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }

  const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to get full name
userSchema.methods.getFullName = function() {
  return `${this.first_name} ${this.last_name}`;
};

// Method to check if user is locked
userSchema.methods.isLocked = function() {
  return this.locked_until && this.locked_until > Date.now();
};

// Method to increment login attempts
userSchema.methods.incrementLoginAttempts = async function() {
  // Reset attempts if lock has expired
  if (this.locked_until && this.locked_until < Date.now()) {
    this.login_attempts = 1;
    this.locked_until = undefined;
  } else {
    this.login_attempts += 1;

    // Lock account after 5 failed attempts for 30 minutes
    if (this.login_attempts >= 5) {
      this.locked_until = new Date(Date.now() + 30 * 60 * 1000);
    }
  }

  return await this.save();
};

// Method to reset login attempts
userSchema.methods.resetLoginAttempts = async function() {
  this.login_attempts = 0;
  this.locked_until = undefined;
  this.last_login = new Date();
  return await this.save();
};

// Method to check if user has permission
userSchema.methods.hasPermission = function(permission) {
  if (this.role === 'global_admin') {
    return true;
  }

  if (this.role === 'tenant_admin') {
    return true;
  }

  return this.permissions.includes(permission);
};

// Virtual for sanitized user object (without sensitive data)
userSchema.methods.toSafeObject = function() {
  return {
    _id: this._id,
    tenant_id: this.tenant_id,
    email: this.email,
    first_name: this.first_name,
    last_name: this.last_name,
    full_name: this.getFullName(),
    role: this.role,
    status: this.status,
    permissions: this.permissions,
    last_login: this.last_login,
    created_at: this.created_at
  };
};

module.exports = mongoose.model('User', userSchema);
