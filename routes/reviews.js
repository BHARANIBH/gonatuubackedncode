const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Chef = require('../models/Chef');
const { verifyToken } = require('../middleware/auth');

// POST /api/reviews — submit review
router.post('/', verifyToken, async (req, res) => {
  try {
    const { bookingId, rating, review } = req.body;

    if (!bookingId || !rating) {
      return res.status(400).json({ message: 'bookingId and rating are required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    if (booking.status !== 'completed') {
      return res.status(400).json({ message: 'Can only review completed bookings' });
    }

    if (booking.rating > 0) {
      return res.status(400).json({ message: 'Already reviewed this booking' });
    }

    booking.rating = rating;
    booking.review = review || '';
    await booking.save();

    // Recalculate chef's average rating
    const chef = await Chef.findById(booking.chefId);
    const allBookingsWithRating = await Booking.find({
      chefId: booking.chefId,
      rating: { $gt: 0 }
    });

    const totalRating = allBookingsWithRating.reduce((sum, b) => sum + b.rating, 0);
    const avgRating = totalRating / allBookingsWithRating.length;

    chef.rating = Math.round(avgRating * 10) / 10;
    chef.totalReviews = allBookingsWithRating.length;
    await chef.save();

    res.json({ message: 'Review submitted successfully', booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to submit review' });
  }
});

// GET /api/reviews/chef/:chefId — get all reviews for a chef
router.get('/chef/:chefId', async (req, res) => {
  try {
    const reviews = await Booking.find({
      chefId: req.params.chefId,
      rating: { $gt: 0 }
    })
      .populate('customerId', 'name profileImage')
      .select('rating review createdAt customerId mealType cuisine')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ reviews });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch reviews' });
  }
});

module.exports = router;
