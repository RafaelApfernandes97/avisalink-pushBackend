/**
 * Script to migrate customer data from custom_data to direct fields
 * Moves email, name, and phone from custom_data Map to direct fields
 *
 * Run with: node src/scripts/migrate-customer-fields.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('../models/Customer');

async function migrateCustomerFields() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    console.log('\n🔍 Finding customers with data in custom_data...');

    // Find all customers
    const customers = await Customer.find({});
    console.log(`Found ${customers.length} customers`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const customer of customers) {
      let needsUpdate = false;
      const updates = {};

      // Check if email is in custom_data but not in direct field
      if (!customer.email && customer.custom_data && customer.custom_data instanceof Map) {
        // Access Map using .get()
        const emailValue = customer.custom_data.get('email');
        const nameValue = customer.custom_data.get('name');
        const phoneValue = customer.custom_data.get('phone');

        if (emailValue) {
          updates.email = emailValue;
          needsUpdate = true;
          console.log(`  - Migrating email for customer ${customer._id}: ${emailValue}`);
        }

        if (nameValue) {
          updates.name = nameValue;
          needsUpdate = true;
          console.log(`  - Migrating name for customer ${customer._id}: ${nameValue}`);
        }

        if (phoneValue) {
          updates.phone = phoneValue;
          needsUpdate = true;
          console.log(`  - Migrating phone for customer ${customer._id}: ${phoneValue}`);
        }
      }

      if (needsUpdate) {
        await Customer.updateOne({ _id: customer._id }, { $set: updates });
        migratedCount++;
        console.log(`  ✅ Migrated customer ${customer._id}`);
      } else {
        skippedCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  - Total customers: ${customers.length}`);
    console.log(`  - Migrated: ${migratedCount}`);
    console.log(`  - Skipped (already migrated): ${skippedCount}`);
    console.log('\n✅ Migration completed successfully!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error migrating customer fields:', error);
    process.exit(1);
  }
}

migrateCustomerFields();
