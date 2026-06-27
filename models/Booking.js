const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  bookingId: { type: String, unique: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  chefId: { type: mongoose.Schema.Types.Mixed, ref: 'Chef', required: false },
  chefServiceId: { type: String, default: '' },
  acceptedByChefId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chef', required: false },
  bookingType: { type: String, enum: ['ondemand', 'scheduled'], default: 'ondemand' },
  date: Date,
  timeSlot: { start: String, end: String },
  duration: { type: Number, default: 2 },
  address: {
    fullAddress: String,
    lat: Number,
    lng: Number
  },
  cuisine: String,
  mealType: { type: String, enum: ['breakfast', 'lunch', 'snacks', 'dinner', 'party', 'all'], default: 'lunch' },
  guestCount: { type: Number, default: 2 },
  specialInstructions: { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'chef_onway', 'arrived', 'cooking', 'completed', 'cancelled'],
    default: 'pending'
  },
  paymentMode: { type: String, enum: ['online', 'cash'], default: 'online' },
  payment: {
    amount: { type: Number, default: 0 },
    razorpayOrderId: { type: String, default: '' },
    razorpayPaymentId: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'paid', 'cash_on_delivery', 'refunded'], default: 'pending' }
  },
  chefLocation: { lat: Number, lng: Number },
  rating: { type: Number, default: 0 },
  review: { type: String, default: '' },
  statusTimestamps: {
    pending: Date,
    accepted: Date,
    rejected: Date,
    chef_onway: Date,
    arrived: Date,
    cooking: Date,
    completed: Date,
    cancelled: Date
  },
  createdAt: { type: Date, default: Date.now }
});

bookingSchema.pre('save', function (next) {
  if (!this.bookingId) {
    this.bookingId = 'CHEF' + Date.now();
  }
  next();
});

module.exports = mongoose.model('Booking', bookingSchema);
