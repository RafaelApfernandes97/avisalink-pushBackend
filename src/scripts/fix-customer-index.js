/**
 * Script to fix Customer model indexes
 * Removes unique constraint from opt_in_token field
 *
 * Run with: node src/scripts/fix-customer-index.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('../models/Customer');

async function fixIndexes() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    console.log('\n📋 Current indexes:');
    const indexes = await Customer.collection.getIndexes();
    console.log(JSON.stringify(indexes, null, 2));

    console.log('\n🔧 Dropping opt_in_token unique index...');
    try {
      await Customer.collection.dropIndex('opt_in_token_1');
      console.log('✅ Unique index dropped successfully');
    } catch (error) {
      if (error.code === 27) {
        console.log('⚠️  Index already dropped or does not exist');
      } else {
        throw error;
      }
    }

    console.log('\n🔄 Syncing model indexes...');
    await Customer.syncIndexes();
    console.log('✅ Indexes synced');

    console.log('\n📋 Updated indexes:');
    const updatedIndexes = await Customer.collection.getIndexes();
    console.log(JSON.stringify(updatedIndexes, null, 2));

    console.log('\n✅ Done! Customer indexes fixed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing indexes:', error);
    process.exit(1);
  }
}

fixIndexes();
