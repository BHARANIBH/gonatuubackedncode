const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  label: { type: String, default: 'Home' },
  fullAddress: String,
  lat: Number,
  lng: Number,
  isDefault: { type: Boolean, default: false }
});

const userSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  phone: { type: String, unique: true, required: true },
  email: { type: String, default: '' },
  role: { type: String, enum: ['customer', 'chef'], default: 'customer' },
  profileImage: { type: String, default: '' },
  address: [addressSchema],
  fcmToken: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
