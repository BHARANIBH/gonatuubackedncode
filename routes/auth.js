const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// In-memory OTP store: phone -> { otp, expiry }
const otpStore = new Map();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(user) {
  return jwt.sign(
    { userId: user._id, phone: user.phone, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.length < 10) {
      return res.status(400).json({ message: 'Valid phone number required' });
    }

    const otp = generateOTP();
    const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes
    otpStore.set(phone, { otp, expiry });

    // Send via Twilio
    try {
      await twilioClient.messages.create({
        body: `Your HomeChef OTP is: ${otp}. Valid for 5 minutes.`,
        from: process.env.TWILIO_FROM_NUMBER,
        to: `+91${phone}`
      });
    } catch (twilioError) {
      console.error('Twilio error:', twilioError.message);
      // For development: still continue and log OTP
      console.log(`DEV OTP for ${phone}: ${otp}`);
    }

    res.json({ message: 'OTP sent successfully', otp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;

    const stored = otpStore.get(phone);
    if (!stored) {
      return res.status(400).json({ message: 'OTP not found. Please request a new one.' });
    }

    if (Date.now() > stored.expiry) {
      otpStore.delete(phone);
      return res.status(400).json({ message: 'OTP expired. Please request a new one.' });
    }

    if (stored.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    otpStore.delete(phone);

    // Find or create user
    let user = await User.findOne({ phone });
    const isNewUser = !user;

    if (!user) {
      user = new User({ phone });
      await user.save();
    }

    const token = generateToken(user);

    res.json({
      message: 'OTP verified successfully',
      token,
      user: { userId: user._id, phone: user.phone, role: user.role, name: user.name },
      isNewUser
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'OTP verification failed' });
  }
});

// POST /api/auth/select-role
router.post('/select-role', verifyToken, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['customer', 'chef'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { role },
      { new: true }
    );

    const token = generateToken(user);

    res.json({
      message: 'Role updated',
      token,
      user: { userId: user._id, phone: user.phone, role: user.role, name: user.name }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update role' });
  }
});

// GET /api/auth/me
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-__v');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

// PUT /api/auth/profile
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { name, email, profileImage, fcmToken } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (profileImage !== undefined) updates.profileImage = profileImage;
    if (fcmToken !== undefined) updates.fcmToken = fcmToken;

    const user = await User.findByIdAndUpdate(req.user.userId, updates, { new: true });
    res.json({ message: 'Profile updated', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// POST /api/auth/address
router.post('/address', verifyToken, async (req, res) => {
  try {
    const { label, fullAddress, lat, lng, isDefault } = req.body;
    const user = await User.findById(req.user.userId);

    if (isDefault) {
      user.address.forEach(a => a.isDefault = false);
    }

    user.address.push({ label, fullAddress, lat, lng, isDefault: isDefault || false });
    await user.save();
    res.json({ message: 'Address added', address: user.address });
  } catch (err) {
    res.status(500).json({ message: 'Failed to add address' });
  }
});

module.exports = router;
