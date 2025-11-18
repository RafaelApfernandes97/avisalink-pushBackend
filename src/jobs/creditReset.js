const cron = require('node-cron');
const creditService = require('../services/creditService');
const logger = require('../utils/logger');

// Run monthly credit reset on the 1st day of each month at 00:00
const scheduleMonthlyReset = () => {
  // Cron expression: At 00:00 on day-of-month 1
  cron.schedule('0 0 1 * *', async () => {
    logger.info('Starting monthly credit reset job');

    try {
      const result = await creditService.resetMonthlyCredits();

      logger.info('Monthly credit reset job completed', result);
    } catch (error) {
      logger.error('Monthly credit reset job failed', {
        error: error.message
      });
    }
  }, {
    timezone: process.env.TIMEZONE || 'UTC'
  });

  logger.info('Monthly credit reset job scheduled');
};

module.exports = { scheduleMonthlyReset };
