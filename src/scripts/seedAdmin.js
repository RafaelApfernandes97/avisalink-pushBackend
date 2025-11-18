require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const logger = require('../utils/logger');

const seedGlobalAdmin = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to database');

    // Check if global admin already exists
    const existingAdmin = await User.findOne({ role: 'global_admin' });

    if (existingAdmin) {
      console.log('Global admin already exists:');
      console.log('Email:', existingAdmin.email);
      console.log('Please use the existing admin or delete it first.');
      process.exit(0);
    }

    // Create global admin
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@webpush-saas.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeThisPassword123!';

    const admin = await User.create({
      email: adminEmail,
      password: adminPassword,
      first_name: 'Global',
      last_name: 'Admin',
      role: 'global_admin',
      status: 'active'
    });

    console.log('\n========================================');
    console.log('Global Admin Created Successfully!');
    console.log('========================================');
    console.log('Email:', admin.email);
    console.log('Password:', adminPassword);
    console.log('========================================');
    console.log('\nIMPORTANT: Please change the password after first login!');
    console.log('\n');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding global admin:', error.message);
    process.exit(1);
  }
};

seedGlobalAdmin();
