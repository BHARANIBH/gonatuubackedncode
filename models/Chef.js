const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  start: String,
  end: String
});

const availabilitySchema = new mongoose.Schema({
  day: String,
  slots: [slotSchema]
});

const chefSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  bio: { type: String, default: '' },
  cuisines: [String],
  specialDishes: [String],
  pricePerHour: { type: Number, default: 500 },
  experience: { type: Number, default: 1 },
  photos: [String],
  rating: { type: Number, default: 0 },
  totalReviews: { type: Number, default: 0 },
  isAvailable: { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
  },
  availability: [availabilitySchema],
  totalEarnings: { type: Number, default: 0 },
  completedBookings: { type: Number, default: 0 },
  documents: {
    idProof: { type: String, default: '' },
    addressProof: { type: String, default: '' }
  }
});

chefSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Chef', chefSchema);
