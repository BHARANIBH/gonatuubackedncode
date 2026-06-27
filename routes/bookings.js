const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Booking = require('../models/Booking');
const Chef = require('../models/Chef');
const Notification = require('../models/Notification');
const { verifyToken } = require('../middleware/auth');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

async function createNotification(userId, title, body, type, bookingId, io) {
  const notif = new Notification({ userId, title, body, type, bookingId });
  await notif.save();
  if (io) {
    io.to(`customer:${userId}`).emit('notification:new', { title, body, type, bookingId });
  }
}

// POST /api/bookings — create booking
router.post('/', verifyToken, async (req, res) => {
  try {
    const io = req.app.get('io');
    const {
      chefId, bookingType, date, timeSlot, duration,
      address, cuisine, mealType, guestCount, specialInstructions,
      paymentMode
    } = req.body;

    let chef = null;
    try {
      chef = await Chef.findById(chefId).populate('userId', 'name phone');
    } catch (e) { /* invalid ObjectId — dummy/service chef */ }

    const amount = chef
      ? chef.pricePerHour * (duration || 2)
      : (req.body.amount || (req.body.pricePerHour || 299) * (duration || 1));

    // Create Razorpay order only for online payments
    const isCash = paymentMode === 'cash';
    let razorpayOrder = null;
    if (!isCash) {
      try {
        razorpayOrder = await razorpay.orders.create({
          amount: amount * 100,
          currency: 'INR',
          receipt: `CHEF${Date.now()}`
        });
      } catch (rzErr) {
        console.error('Razorpay error:', rzErr.message);
      }
    }

    const isRealChef = chef !== null;
    const booking = new Booking({
      customerId: req.user.userId,
      chefId: isRealChef ? chefId : undefined,
      chefServiceId: isRealChef ? '' : chefId,
      bookingType: bookingType || 'ondemand',
      date: date ? new Date(date) : new Date(),
      timeSlot,
      duration: duration || 2,
      address,
      cuisine,
      mealType: mealType || 'lunch',
      guestCount: guestCount || 2,
      specialInstructions,
      paymentMode: isCash ? 'cash' : 'online',
      payment: {
        amount,
        razorpayOrderId: razorpayOrder ? razorpayOrder.id : '',
        status: isCash ? 'cash_on_delivery' : 'pending'
      },
      statusTimestamps: { pending: new Date() }
    });

    await booking.save();

    // Notify chef via socket — always broadcast to all_chefs room
    const bookingPayload = {
      bookingId: booking._id,
      bookingRef: booking.bookingId,
      customer: req.user.name || req.user.phone,
      phone: req.user.phone,
      cuisine,
      mealType,
      guestCount,
      duration,
      amount,
      address,
      paymentMode: isCash ? 'cash' : 'online',
      payment: { amount },
      date: booking.date
    };
    if (chef) io.to(`chef:${chefId}`).emit('booking:new', bookingPayload);
    io.to('all_chefs').emit('booking:new', bookingPayload);

    // Notify chef (only if real chef)
    if (chef?.userId?._id) {
      await createNotification(
        chef.userId._id, 'New Booking Request',
        `New ${mealType} booking for ${guestCount} guests`,
        'booking_new', booking._id, io
      );
    }

    res.status(201).json({
      message: 'Booking created',
      booking,
      razorpayOrderId: razorpayOrder ? razorpayOrder.id : null,
      amount,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create booking' });
  }
});

// POST /api/bookings/:id/confirm-payment
router.post('/:id/confirm-payment', verifyToken, async (req, res) => {
  try {
    const io = req.app.get('io');
    const { razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;

    // Verify signature
    const body = razorpayOrderId + '|' + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({ message: 'Payment verification failed' });
    }

    const booking = await Booking.findById(req.params.id)
      .populate('customerId', 'name phone')
      .populate('chefId');

    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    booking.payment.razorpayPaymentId = razorpayPaymentId;
    booking.payment.status = 'paid';
    booking.status = 'accepted';
    booking.statusTimestamps.accepted = new Date();
    await booking.save();

    io.to(`customer:${booking.customerId._id}`).emit('booking:status', {
      bookingId: booking._id,
      status: 'accepted'
    });

    io.to(`chef:${booking.chefId._id}`).emit('booking:accepted', {
      bookingId: booking._id,
      paymentId: razorpayPaymentId
    });

    await createNotification(
      booking.customerId._id,
      'Booking Confirmed!',
      'Your booking has been confirmed and payment received.',
      'booking_confirmed', booking._id, io
    );

    res.json({ message: 'Payment confirmed, booking accepted', booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Payment confirmation failed' });
  }
});

// POST /api/bookings/:id/accept (chef accepts)
router.post('/:id/accept', verifyToken, async (req, res) => {
  try {
    const io = req.app.get('io');
    const booking = await Booking.findById(req.params.id).populate('customerId', 'name phone');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    // Find chef profile for this user
    const chefDoc = await Chef.findOne({ userId: req.user.userId });

    booking.status = 'accepted';
    booking.statusTimestamps.accepted = new Date();
    // Assign chef if booking was from the all_chefs pool (dummy chef)
    if (!booking.chefId && chefDoc) {
      booking.chefId = chefDoc._id;
      booking.acceptedByChefId = chefDoc._id;
    }
    await booking.save();

    io.to(`customer:${booking.customerId._id}`).emit('booking:status', {
      bookingId: booking._id, status: 'accepted'
    });

    await createNotification(
      booking.customerId._id, 'Booking Accepted!',
      'Your chef has accepted the booking.',
      'booking_accepted', booking._id, io
    );

    res.json({ message: 'Booking accepted', booking });
  } catch (err) {
    res.status(500).json({ message: 'Failed to accept booking' });
  }
});

// POST /api/bookings/:id/reject (chef rejects)
router.post('/:id/reject', verifyToken, async (req, res) => {
  try {
    const io = req.app.get('io');
    const { reason } = req.body;
    const booking = await Booking.findById(req.params.id).populate('customerId', 'name phone');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    booking.status = 'rejected';
    booking.statusTimestamps.rejected = new Date();
    await booking.save();

    io.to(`customer:${booking.customerId._id}`).emit('booking:status', {
      bookingId: booking._id, status: 'rejected', reason
    });

    await createNotification(
      booking.customerId._id, 'Booking Rejected',
      reason || 'Chef is not available. Please try another chef.',
      'booking_rejected', booking._id, io
    );

    res.json({ message: 'Booking rejected', booking });
  } catch (err) {
    res.status(500).json({ message: 'Failed to reject booking' });
  }
});

// POST /api/bookings/:id/status (chef updates status)
router.post('/:id/status', verifyToken, async (req, res) => {
  try {
    const io = req.app.get('io');
    const { status } = req.body;
    const validStatuses = ['chef_onway', 'arrived', 'cooking', 'completed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const booking = await Booking.findById(req.params.id)
      .populate('customerId', 'name phone')
      .populate('chefId');

    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    booking.status = status;
    booking.statusTimestamps[status] = new Date();

    if (status === 'completed' && booking.chefId?._id) {
      await Chef.findByIdAndUpdate(booking.chefId._id, {
        $inc: {
          totalEarnings: booking.payment.amount,
          completedBookings: 1
        }
      });
    }

    await booking.save();

    io.to(`customer:${booking.customerId._id}`).emit('booking:status', {
      bookingId: booking._id, status, timestamp: new Date()
    });
    io.to(`booking:${booking._id}`).emit('booking:status', {
      bookingId: booking._id, status, timestamp: new Date()
    });

    const statusMessages = {
      chef_onway: { title: 'Chef is on the way!', body: 'Your chef is heading to your location.' },
      arrived: { title: 'Chef has arrived!', body: 'Your chef is at your doorstep.' },
      cooking: { title: 'Cooking started!', body: 'Your chef has started cooking.' },
      completed: { title: 'Booking completed!', body: 'Please rate your experience.' }
    };

    if (statusMessages[status]) {
      await createNotification(
        booking.customerId._id,
        statusMessages[status].title,
        statusMessages[status].body,
        `booking_${status}`, booking._id, io
      );
    }

    res.json({ message: `Status updated to ${status}`, booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update status' });
  }
});

// GET /api/bookings/my-bookings (customer)
router.get('/my-bookings', verifyToken, async (req, res) => {
  try {
    const bookings = await Booking.find({ customerId: req.user.userId })
      .populate({ path: 'chefId', populate: { path: 'userId', select: 'name phone profileImage' } })
      .sort({ createdAt: -1 });
    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch bookings' });
  }
});

// GET /api/bookings/chef-bookings (chef — includes dummy-chef bookings accepted by this chef)
router.get('/chef-bookings', verifyToken, async (req, res) => {
  try {
    const Chef = require('../models/Chef');
    let chef = await Chef.findOne({ userId: req.user.userId });
    if (!chef) return res.json({ bookings: [] });

    // Find bookings assigned to this chef OR accepted by this chef from the all_chefs pool
    const bookings = await Booking.find({
      $or: [
        { chefId: chef._id },
        { acceptedByChefId: chef._id }
      ]
    })
      .populate('customerId', 'name phone profileImage address')
      .sort({ createdAt: -1 });
    res.json({ bookings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch chef bookings' });
  }
});

// GET /api/bookings/:id
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('customerId', 'name phone profileImage')
      .populate({ path: 'chefId', populate: { path: 'userId', select: 'name phone profileImage' } });
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    res.json({ booking });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch booking' });
  }
});

// POST /api/bookings/:id/cancel
router.post('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const io = req.app.get('io');
    const booking = await Booking.findById(req.params.id)
      .populate('chefId');

    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    if (!['pending', 'accepted'].includes(booking.status)) {
      return res.status(400).json({ message: 'Cannot cancel this booking' });
    }

    booking.status = 'cancelled';
    booking.statusTimestamps.cancelled = new Date();
    await booking.save();

    if (booking.chefId?._id) {
      io.to(`chef:${booking.chefId._id}`).emit('booking:status', {
        bookingId: booking._id, status: 'cancelled'
      });
    }

    res.json({ message: 'Booking cancelled', booking });
  } catch (err) {
    res.status(500).json({ message: 'Failed to cancel booking' });
  }
});

module.exports = router;
