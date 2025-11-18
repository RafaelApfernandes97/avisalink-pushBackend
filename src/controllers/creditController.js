const Tenant = require('../models/Tenant');
const CreditTransaction = require('../models/CreditTransaction');
const creditService = require('../services/creditService');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/response');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

// Get credit balance
exports.getBalance = asyncHandler(async (req, res, next) => {
  const tenant = await Tenant.findById(req.tenant._id);

  if (!tenant) {
    return next(new NotFoundError('Tenant not found'));
  }

  const balanceData = {
    available: tenant.credits.current_balance,
    limit: tenant.credits.monthly_limit,
    usedThisMonth: tenant.credits.used_this_month,
    last_reset_date: tenant.credits.last_reset_date,
    rollover_enabled: tenant.credits.rollover_enabled,
    rollover_balance: tenant.credits.rollover_balance,
    usage_percentage: ((tenant.credits.used_this_month / tenant.credits.monthly_limit) * 100).toFixed(2),
    status: tenant.credits.current_balance > 0 ? 'active' : 'depleted',
    trend: 'up',
    trendPercentage: 0,
    totalPurchased: tenant.credits.rollover_balance + tenant.credits.used_this_month
  };

  successResponse(res, 200, balanceData);
});

// Get credit usage (last 6 months)
exports.getUsage = asyncHandler(async (req, res, next) => {
  const tenantId = req.tenant._id;
  const now = new Date();

  // Generate last 6 months data
  const usageData = [];
  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59);

    const [used, purchased] = await Promise.all([
      CreditTransaction.getTotalConsumption(tenantId, monthStart, monthEnd),
      CreditTransaction.getTotalRecharges(tenantId, monthStart, monthEnd)
    ]);

    usageData.push({
      month: monthDate.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }),
      used: used || 0,
      purchased: purchased || 0
    });
  }

  successResponse(res, 200, usageData);
});

// Get credit transactions
exports.getTransactions = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20
  } = req.query;

  const tenantId = req.tenant._id;

  const transactions = await CreditTransaction.find({ tenant_id: tenantId })
    .sort({ created_at: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .lean();

  const total = await CreditTransaction.countDocuments({ tenant_id: tenantId });

  paginatedResponse(res, 200, transactions, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});

// Request credits
exports.requestCredits = asyncHandler(async (req, res, next) => {
  const { amount, reason } = req.body;
  const tenantId = req.tenant._id;

  if (!amount || amount <= 0) {
    return errorResponse(res, 400, 'Amount must be greater than 0');
  }

  // Create a credit request transaction
  await CreditTransaction.create({
    tenant_id: tenantId,
    type: 'request',
    amount: amount,
    description: reason || 'Credit request from tenant',
    metadata: {
      reason,
      requested_by: req.user._id,
      status: 'pending'
    }
  });

  logger.info('Credit request created', {
    tenant_id: tenantId,
    amount,
    requested_by: req.user._id
  });

  successResponse(res, 201, null, 'Credit request submitted successfully');
});

// Get credit transaction history
exports.getHistory = asyncHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 50,
    type,
    start_date,
    end_date
  } = req.query;

  const tenantId = req.tenant._id;

  const options = {
    limit: parseInt(limit),
    skip: (parseInt(page) - 1) * parseInt(limit),
    type,
    startDate: start_date,
    endDate: end_date
  };

  const [transactions, total] = await Promise.all([
    CreditTransaction.getByTenant(tenantId, options),
    CreditTransaction.countDocuments({
      tenant_id: tenantId,
      ...(type && { type }),
      ...(start_date || end_date ? {
        created_at: {
          ...(start_date && { $gte: new Date(start_date) }),
          ...(end_date && { $lte: new Date(end_date) })
        }
      } : {})
    })
  ]);

  paginatedResponse(res, 200, transactions, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  });
});

// Add credits (Global Admin only)
exports.addCredits = asyncHandler(async (req, res, next) => {
  const { amount, description } = req.body;
  const tenantId = req.params.id || req.params.tenantId;

  if (!amount || amount <= 0) {
    return errorResponse(res, 400, 'Amount must be greater than 0');
  }

  const result = await creditService.addCredits(
    tenantId,
    amount,
    req.user._id,
    description || 'Manual credit recharge'
  );

  successResponse(res, 200, result, 'Credits added successfully');
});

// Update credit limit (Global Admin only)
exports.updateLimit = asyncHandler(async (req, res, next) => {
  const { monthly_limit } = req.body;
  const tenantId = req.params.id || req.params.tenantId;

  if (!monthly_limit || monthly_limit < 0) {
    return errorResponse(res, 400, 'Monthly limit must be 0 or greater');
  }

  const result = await creditService.updateMonthlyLimit(
    tenantId,
    monthly_limit,
    req.user._id
  );

  successResponse(res, 200, result, 'Credit limit updated successfully');
});

// Get usage report
exports.getUsageReport = asyncHandler(async (req, res, next) => {
  const {
    start_date,
    end_date
  } = req.query;

  const tenantId = req.tenant._id;

  // Default to current month if no dates provided
  const now = new Date();
  const startDate = start_date
    ? new Date(start_date)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = end_date
    ? new Date(end_date)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const report = await creditService.getUsageReport(
    tenantId,
    startDate,
    endDate
  );

  successResponse(res, 200, report);
});

// Check credits availability
exports.checkCredits = asyncHandler(async (req, res, next) => {
  const { required_amount = 1 } = req.query;
  const tenantId = req.tenant._id;

  const result = await creditService.checkCredits(tenantId, parseInt(required_amount));

  successResponse(res, 200, result);
});

// Get credit statistics
exports.getStats = asyncHandler(async (req, res, next) => {
  const tenantId = req.tenant._id;

  // Get current month dates
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  // Get last month dates
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [
    currentMonthConsumption,
    lastMonthConsumption,
    currentMonthRecharges,
    totalLifetimeConsumption,
    totalLifetimeRecharges
  ] = await Promise.all([
    CreditTransaction.getTotalConsumption(tenantId, monthStart, monthEnd),
    CreditTransaction.getTotalConsumption(tenantId, lastMonthStart, lastMonthEnd),
    CreditTransaction.getTotalRecharges(tenantId, monthStart, monthEnd),
    CreditTransaction.getTotalConsumption(tenantId, new Date(0), now),
    CreditTransaction.getTotalRecharges(tenantId, new Date(0), now)
  ]);

  // Get tenant info
  const tenant = await Tenant.findById(tenantId);

  // Get consumption by day (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const consumptionByDay = await CreditTransaction.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        type: 'consumption',
        created_at: { $gte: thirtyDaysAgo }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$created_at'
          }
        },
        total: { $sum: { $abs: '$amount' } }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);

  // Calculate trends
  const consumptionChange = lastMonthConsumption > 0
    ? (((currentMonthConsumption - lastMonthConsumption) / lastMonthConsumption) * 100).toFixed(2)
    : 0;

  const statsData = {
    current_balance: {
      balance: tenant.credits.current_balance,
      monthly_limit: tenant.credits.monthly_limit,
      used_this_month: tenant.credits.used_this_month,
      usage_percentage: ((tenant.credits.used_this_month / tenant.credits.monthly_limit) * 100).toFixed(2),
      rollover_balance: tenant.credits.rollover_balance
    },
    current_month: {
      consumption: currentMonthConsumption,
      recharges: currentMonthRecharges,
      net_change: currentMonthRecharges - currentMonthConsumption
    },
    last_month: {
      consumption: lastMonthConsumption
    },
    lifetime: {
      total_consumption: totalLifetimeConsumption,
      total_recharges: totalLifetimeRecharges
    },
    trends: {
      consumption_change: parseFloat(consumptionChange),
      trend: consumptionChange > 0 ? 'increasing' : consumptionChange < 0 ? 'decreasing' : 'stable'
    },
    consumption_by_day: consumptionByDay.map(day => ({
      date: day._id,
      amount: day.total
    }))
  };

  successResponse(res, 200, statsData);
});

// Adjust credits (Global Admin only - for corrections)
exports.adjustCredits = asyncHandler(async (req, res, next) => {
  const { amount, reason } = req.body;
  const tenantId = req.params.id || req.params.tenantId;

  if (!amount || amount === 0) {
    return errorResponse(res, 400, 'Amount must be non-zero');
  }

  if (!reason) {
    return errorResponse(res, 400, 'Reason is required for credit adjustments');
  }

  const tenant = await Tenant.findById(tenantId);

  if (!tenant) {
    return next(new NotFoundError('Tenant not found'));
  }

  const balanceBefore = tenant.credits.current_balance;

  // Adjust credits
  if (amount > 0) {
    await tenant.addCredits(amount);
  } else {
    // Negative adjustment
    const absAmount = Math.abs(amount);
    if (tenant.credits.current_balance >= absAmount) {
      tenant.credits.current_balance -= absAmount;
      await tenant.save();
    } else {
      return errorResponse(res, 400, 'Insufficient credits for this adjustment');
    }
  }

  // Record transaction
  await CreditTransaction.createTransaction({
    tenant_id: tenantId,
    type: 'adjustment',
    amount: amount,
    balance_before: balanceBefore,
    balance_after: tenant.credits.current_balance,
    description: reason,
    reference: 'manual',
    performed_by: req.user._id,
    metadata: {
      reason
    }
  });

  logger.warn('Credit adjustment performed', {
    tenant_id: tenantId,
    amount,
    reason,
    adjusted_by: req.user._id
  });

  successResponse(res, 200, {
    balance_before: balanceBefore,
    balance_after: tenant.credits.current_balance,
    adjustment: amount
  }, 'Credits adjusted successfully');
});
