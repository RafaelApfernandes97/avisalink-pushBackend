const Tenant = require('../models/Tenant');
const CreditTransaction = require('../models/CreditTransaction');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

class CreditService {
  // Add credits to tenant (recharge)
  async addCredits(tenantId, amount, userId, description = 'Manual credit recharge') {
    try {
      const tenant = await Tenant.findById(tenantId);

      if (!tenant) {
        throw new Error('Tenant not found');
      }

      const balanceBefore = tenant.credits.current_balance;

      // Add credits
      await tenant.addCredits(amount);

      // Record transaction
      await CreditTransaction.createTransaction({
        tenant_id: tenantId,
        type: 'recharge',
        amount: amount,
        balance_before: balanceBefore,
        balance_after: tenant.credits.current_balance,
        description,
        reference: 'manual',
        performed_by: userId
      });

      // Create audit log
      await AuditLog.log({
        tenant_id: tenantId,
        user_id: userId,
        action: 'credits_added',
        resource_type: 'credit',
        details: {
          amount,
          balance_before: balanceBefore,
          balance_after: tenant.credits.current_balance,
          description
        },
        severity: 'info'
      });

      logger.info('Credits added successfully', {
        tenant_id: tenantId,
        amount,
        new_balance: tenant.credits.current_balance
      });

      return {
        success: true,
        amount_added: amount,
        new_balance: tenant.credits.current_balance
      };
    } catch (error) {
      logger.error('Error adding credits', {
        tenant_id: tenantId,
        amount,
        error: error.message
      });

      throw error;
    }
  }

  // Update monthly credit limit
  async updateMonthlyLimit(tenantId, newLimit, userId) {
    try {
      const tenant = await Tenant.findById(tenantId);

      if (!tenant) {
        throw new Error('Tenant not found');
      }

      const oldLimit = tenant.credits.monthly_limit;

      tenant.credits.monthly_limit = newLimit;
      await tenant.save();

      // Create audit log
      await AuditLog.log({
        tenant_id: tenantId,
        user_id: userId,
        action: 'credit_limit_updated',
        resource_type: 'credit',
        changes: {
          before: { monthly_limit: oldLimit },
          after: { monthly_limit: newLimit }
        },
        severity: 'info'
      });

      logger.info('Credit limit updated', {
        tenant_id: tenantId,
        old_limit: oldLimit,
        new_limit: newLimit
      });

      return {
        success: true,
        old_limit: oldLimit,
        new_limit: newLimit
      };
    } catch (error) {
      logger.error('Error updating credit limit', {
        tenant_id: tenantId,
        error: error.message
      });

      throw error;
    }
  }

  // Reset monthly credits for all tenants
  async resetMonthlyCredits() {
    try {
      const tenants = await Tenant.find({ status: 'active' });

      const results = await Promise.allSettled(
        tenants.map(async (tenant) => {
          const balanceBefore = tenant.credits.current_balance;

          await tenant.resetMonthlyCredits();

          // Record transaction
          await CreditTransaction.createTransaction({
            tenant_id: tenant._id,
            type: 'reset',
            amount: tenant.credits.monthly_limit,
            balance_before: balanceBefore,
            balance_after: tenant.credits.current_balance,
            description: 'Monthly credit reset',
            reference: 'automatic',
            metadata: {
              period_start: new Date(),
              rollover_enabled: tenant.credits.rollover_enabled,
              rollover_amount: tenant.credits.rollover_balance
            }
          });

          // Create audit log
          await AuditLog.log({
            tenant_id: tenant._id,
            action: 'credits_reset',
            resource_type: 'credit',
            details: {
              balance_before: balanceBefore,
              balance_after: tenant.credits.current_balance,
              monthly_limit: tenant.credits.monthly_limit,
              rollover_enabled: tenant.credits.rollover_enabled,
              rollover_amount: tenant.credits.rollover_balance
            },
            severity: 'info'
          });

          return {
            tenant_id: tenant._id,
            tenant_name: tenant.name,
            success: true
          };
        })
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      logger.info('Monthly credit reset completed', {
        total_tenants: tenants.length,
        successful,
        failed
      });

      return {
        success: true,
        total_tenants: tenants.length,
        successful,
        failed
      };
    } catch (error) {
      logger.error('Error resetting monthly credits', {
        error: error.message
      });

      throw error;
    }
  }

  // Get credit usage report for tenant
  async getUsageReport(tenantId, startDate, endDate) {
    try {
      const tenant = await Tenant.findById(tenantId);

      if (!tenant) {
        throw new Error('Tenant not found');
      }

      // Get transactions for period
      const transactions = await CreditTransaction.getByTenant(tenantId, {
        startDate,
        endDate,
        limit: 1000
      });

      // Calculate totals
      const totalConsumption = await CreditTransaction.getTotalConsumption(
        tenantId,
        startDate,
        endDate
      );

      const totalRecharges = await CreditTransaction.getTotalRecharges(
        tenantId,
        startDate,
        endDate
      );

      return {
        success: true,
        tenant: {
          id: tenant._id,
          name: tenant.name,
          current_balance: tenant.credits.current_balance,
          monthly_limit: tenant.credits.monthly_limit,
          used_this_month: tenant.credits.used_this_month
        },
        period: {
          start_date: startDate,
          end_date: endDate
        },
        summary: {
          total_consumption: totalConsumption,
          total_recharges: totalRecharges,
          net_change: totalRecharges - totalConsumption
        },
        transactions
      };
    } catch (error) {
      logger.error('Error generating usage report', {
        tenant_id: tenantId,
        error: error.message
      });

      throw error;
    }
  }

  // Check if tenant has sufficient credits
  async checkCredits(tenantId, requiredAmount = 1) {
    try {
      const tenant = await Tenant.findById(tenantId);

      if (!tenant) {
        throw new Error('Tenant not found');
      }

      return {
        has_credits: tenant.hasCredits(requiredAmount),
        current_balance: tenant.credits.current_balance,
        required: requiredAmount
      };
    } catch (error) {
      logger.error('Error checking credits', {
        tenant_id: tenantId,
        error: error.message
      });

      throw error;
    }
  }
}

module.exports = new CreditService();
