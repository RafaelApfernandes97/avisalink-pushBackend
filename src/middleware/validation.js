const Joi = require('joi');
const { AppError } = require('../utils/errors');

// Middleware to validate request body
exports.validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      return next(new AppError(errorMessage, 400));
    }

    req.body = value;
    next();
  };
};

// Validation schemas
exports.schemas = {
  // User validation
  createUser: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    first_name: Joi.string().max(50).required(),
    last_name: Joi.string().max(50).required(),
    role: Joi.string().valid('global_admin', 'tenant_admin', 'operator').default('operator'),
    tenant_id: Joi.string().when('role', {
      is: Joi.string().valid('tenant_admin', 'operator'),
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    permissions: Joi.array().items(
      Joi.string().valid(
        'manage_users',
        'send_notifications',
        'view_analytics',
        'manage_opt_ins',
        'manage_credits',
        'view_audit_logs'
      )
    )
  }),

  updateUser: Joi.object({
    email: Joi.string().email(),
    password: Joi.string().min(8),
    first_name: Joi.string().max(50),
    last_name: Joi.string().max(50),
    role: Joi.string().valid('global_admin', 'tenant_admin', 'operator'),
    tenant_id: Joi.string(),
    status: Joi.string().valid('active', 'inactive', 'suspended'),
    permissions: Joi.array().items(
      Joi.string().valid(
        'manage_users',
        'send_notifications',
        'view_analytics',
        'manage_opt_ins',
        'manage_credits',
        'view_audit_logs'
      )
    )
  }),

  // Authentication validation
  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  changePassword: Joi.object({
    current_password: Joi.string().required(),
    new_password: Joi.string().min(8).required()
  }),

  // Tenant validation
  createTenant: Joi.object({
    name: Joi.string().max(100).required(),
    email: Joi.string().email().required(),
    slug: Joi.string().lowercase().pattern(/^[a-z0-9-]+$/),
    credits: Joi.object({
      monthly_limit: Joi.number().min(0).default(100),
      rollover_enabled: Joi.boolean().default(true)
    }),
    settings: Joi.object({
      timezone: Joi.string().default('UTC'),
      opt_in_link_expiry_days: Joi.number().min(1).default(30)
    }),
    metadata: Joi.object({
      industry: Joi.string(),
      company_size: Joi.string(),
      website: Joi.string().uri(),
      phone: Joi.string(),
      address: Joi.object({
        street: Joi.string(),
        city: Joi.string(),
        state: Joi.string(),
        country: Joi.string(),
        postal_code: Joi.string()
      })
    })
  }),

  updateTenant: Joi.object({
    name: Joi.string().max(100),
    email: Joi.string().email(),
    status: Joi.string().valid('active', 'suspended', 'inactive'),
    credits: Joi.object({
      monthly_limit: Joi.number().min(0),
      rollover_enabled: Joi.boolean()
    }),
    settings: Joi.object({
      timezone: Joi.string(),
      opt_in_link_expiry_days: Joi.number().min(1)
    }),
    metadata: Joi.object({
      industry: Joi.string(),
      company_size: Joi.string(),
      website: Joi.string().uri(),
      phone: Joi.string(),
      address: Joi.object({
        street: Joi.string(),
        city: Joi.string(),
        state: Joi.string(),
        country: Joi.string(),
        postal_code: Joi.string()
      })
    })
  }),

  // Notification validation
  createNotification: Joi.object({
    title: Joi.string().max(100).required(),
    message: Joi.string().max(500).required(),
    image_url: Joi.string().uri(),
    icon_url: Joi.string().uri(),
    badge_url: Joi.string().uri(),
    action_url: Joi.string().uri(),
    actions: Joi.array().items(
      Joi.object({
        action: Joi.string().required(),
        title: Joi.string().required(),
        icon: Joi.string()
      })
    ),
    targeting: Joi.object({
      customer_ids: Joi.array().items(Joi.string()),
      tags: Joi.array().items(Joi.string()),
      send_to_all: Joi.boolean().default(false)
    }).required(),
    schedule: Joi.object({
      scheduled_for: Joi.date(),
      timezone: Joi.string()
    })
  }),

  // Opt-in link validation
  createOptInLink: Joi.object({
    name: Joi.string().max(100).required(),
    description: Joi.string().max(500).allow(''),
    status: Joi.string().valid('active', 'inactive', 'expired'),
    expiry_date: Joi.date(),
    customization: Joi.object({
      company_name: Joi.string().allow(''),
      page_title: Joi.string().allow(''),
      page_description: Joi.string().allow(''),
      button_text: Joi.string().allow(''),
      success_message: Joi.string().allow(''),
      logo_url: Joi.string().uri().allow(''),
      primary_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/),
      secondary_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/),
      background_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/),
      text_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/),
      button_text_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/)
    }),
    form_fields: Joi.object({
      require_name: Joi.boolean(),
      require_email: Joi.boolean(),
      require_phone: Joi.boolean(),
      custom_fields: Joi.array().items(Joi.object({
        label: Joi.string(),
        field_name: Joi.string(),
        type: Joi.string().valid('text', 'email', 'phone', 'select', 'checkbox'),
        required: Joi.boolean(),
        options: Joi.array().items(Joi.string())
      }))
    }),
    targeting: Joi.object({
      tags: Joi.array().items(Joi.string()),
      allowed_domains: Joi.array().items(Joi.string()),
      max_subscriptions: Joi.number().min(1)
    })
  }),

  // Customer opt-in validation
  customerOptIn: Joi.object({
    subscription: Joi.object({
      endpoint: Joi.string().required(),
      keys: Joi.object({
        p256dh: Joi.string().required(),
        auth: Joi.string().required()
      }).required()
    }).optional().allow(null),
    email: Joi.string().email().optional().allow(''),
    name: Joi.string().max(100).optional().allow(''),
    phone: Joi.string().max(20).optional().allow(''),
    customer_identifier: Joi.string().optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    custom_data: Joi.object().optional()
  }),

  // Credit operations
  addCredits: Joi.object({
    amount: Joi.number().min(1).required(),
    description: Joi.string().max(500)
  })
};
