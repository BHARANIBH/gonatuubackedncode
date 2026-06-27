const express = require('express');
const router = express.Router();
const Chef = require('../models/Chef');
const User = require('../models/User');
const Booking = require('../models/Booking');
const { verifyToken, requireRole } = require('../middleware/auth');

// POST /api/chefs/setup
router.post('/setup', verifyToken, async (req, res) => {
  try {
    const { bio, cuisines, specialDishes, pricePerHour, experience, availability, photos } = req.body;

    let chef = await Chef.findOne({ userId: req.user.userId });

    if (chef) {
      chef.bio = bio || chef.bio;
      chef.cuisines = cuisines || chef.cuisines;
      chef.specialDishes = specialDishes || chef.specialDishes;
      chef.pricePerHour = pricePerHour || chef.pricePerHour;
      chef.experience = experience || chef.experience;
      chef.availability = availability || chef.availability;
      if (photos) chef.photos = photos;
      await chef.save();
    } else {
      chef = new Chef({
        userId: req.user.userId,
        bio, cuisines, specialDishes, pricePerHour, experience, availability, photos
      });
      await chef.save();
    }

    // Update user role to chef
    await User.findByIdAndUpdate(req.user.userId, { role: 'chef' });

    const populated = await Chef.findById(chef._id).populate('userId', 'name phone profileImage email');
    res.json({ message: 'Chef profile saved', chef: populated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to setup chef profile' });
  }
});

// GET /api/chefs/nearby
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, radius = 20, cuisine, minRating, maxPrice, available } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ message: 'lat and lng are required' });
    }

    const radiusInMeters = parseFloat(radius) * 1000;

    let query = {
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: radiusInMeters
        }
      }
    };

    if (available === 'true') query.isAvailable = true;
    if (cuisine) query.cuisines = { $in: [cuisine] };
    if (minRating) query.rating = { $gte: parseFloat(minRating) };
    if (maxPrice) query.pricePerHour = { $lte: parseFloat(maxPrice) };

    const chefs = await Chef.find(query)
      .populate('userId', 'name phone profileImage')
      .limit(50);

    res.json({ chefs, count: chefs.length });
  } catch (err) {
    console.error(err);
    // Fallback: return all available chefs if geospatial fails
    try {
      const chefs = await Chef.find({ isAvailable: true })
        .populate('userId', 'name phone profileImage')
        .limit(50);
      res.json({ chefs, count: chefs.length });
    } catch (e) {
      res.status(500).json({ message: 'Failed to fetch chefs' });
    }
  }
});

// GET /api/chefs/all
router.get('/all', async (req, res) => {
  try {
    const chefs = await Chef.find()
      .populate('userId', 'name phone profileImage')
      .sort({ rating: -1 })
      .limit(100);
    res.json({ chefs, count: chefs.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch chefs' });
  }
});

// GET /api/chefs/my-profile (chef's own profile)
router.get('/my-profile', verifyToken, async (req, res) => {
  try {
    let chef = await Chef.findOne({ userId: req.user.userId })
      .populate('userId', 'name phone profileImage email');
    if (!chef) {
      // Auto-create minimal chef profile on first access
      const newChef = new Chef({ userId: req.user.userId, pricePerHour: 299, isAvailable: true });
      await newChef.save();
      chef = await Chef.findById(newChef._id).populate('userId', 'name phone profileImage email');
    }
    res.json({ chef });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch chef profile' });
  }
});

// GET /api/chefs/:chefId
router.get('/:chefId', async (req, res) => {
  try {
    const chef = await Chef.findById(req.params.chefId)
      .populate('userId', 'name phone profileImage email');
    if (!chef) return res.status(404).json({ message: 'Chef not found' });
    res.json({ chef });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch chef' });
  }
});

// PUT /api/chefs/:chefId/location
router.put('/:chefId/location', verifyToken, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const chef = await Chef.findByIdAndUpdate(
      req.params.chefId,
      { location: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] } },
      { new: true }
    );
    res.json({ message: 'Location updated', chef });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update location' });
  }
});

// PUT /api/chefs/:chefId/availability
router.put('/:chefId/availability', verifyToken, async (req, res) => {
  try {
    const { availability } = req.body;
    const chef = await Chef.findByIdAndUpdate(
      req.params.chefId,
      { availability },
      { new: true }
    );
    res.json({ message: 'Availability updated', chef });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update availability' });
  }
});

// PUT /api/chefs/:chefId/toggle-available
router.put('/:chefId/toggle-available', verifyToken, async (req, res) => {
  try {
    const chef = await Chef.findById(req.params.chefId);
    if (!chef) return res.status(404).json({ message: 'Chef not found' });

    chef.isAvailable = !chef.isAvailable;
    await chef.save();

    res.json({ message: `Chef is now ${chef.isAvailable ? 'available' : 'busy'}`, isAvailable: chef.isAvailable });
  } catch (err) {
    res.status(500).json({ message: 'Failed to toggle availability' });
  }
});

// GET /api/chefs/:chefId/earnings
router.get('/:chefId/earnings', verifyToken, async (req, res) => {
  try {
    const chef = await Chef.findById(req.params.chefId);
    if (!chef) return res.status(404).json({ message: 'Chef not found' });

    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const completedBookings = await Booking.find({
      chefId: req.params.chefId,
      status: 'completed',
      'payment.status': 'paid'
    });

    const daily = completedBookings
      .filter(b => new Date(b.createdAt) >= startOfDay)
      .reduce((sum, b) => sum + b.payment.amount, 0);

    const weekly = completedBookings
      .filter(b => new Date(b.createdAt) >= startOfWeek)
      .reduce((sum, b) => sum + b.payment.amount, 0);

    const monthly = completedBookings
      .filter(b => new Date(b.createdAt) >= startOfMonth)
      .reduce((sum, b) => sum + b.payment.amount, 0);

    // Weekly breakdown (last 4 weeks)
    const weeklyBreakdown = [];
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - i * 7);

      const weekEarnings = completedBookings
        .filter(b => {
          const date = new Date(b.createdAt);
          return date >= weekStart && date < weekEnd;
        })
        .reduce((sum, b) => sum + b.payment.amount, 0);

      weeklyBreakdown.push({ week: `Week ${4 - i}`, earnings: weekEarnings });
    }

    res.json({
      totalEarnings: chef.totalEarnings,
      daily, weekly, monthly,
      weeklyBreakdown,
      completedBookings: chef.completedBookings
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch earnings' });
  }
});

module.exports = router;
