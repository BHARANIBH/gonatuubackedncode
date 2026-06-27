const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const { verifyToken } = require('../middleware/auth');

// POST /api/chat — send message
router.post('/', verifyToken, async (req, res) => {
  try {
    const io = req.app.get('io');
    const { bookingId, message } = req.body;

    if (!bookingId || !message) {
      return res.status(400).json({ message: 'bookingId and message are required' });
    }

    const msg = new Message({
      bookingId,
      senderId: req.user.userId,
      senderRole: req.user.role,
      message,
      timestamp: new Date()
    });

    await msg.save();
    const populated = await Message.findById(msg._id).populate('senderId', 'name profileImage');

    // Emit to chat room
    io.to(`chat:${bookingId}`).emit('chat:message', {
      _id: populated._id,
      bookingId,
      senderId: populated.senderId,
      senderRole: req.user.role,
      message,
      timestamp: msg.timestamp
    });

    res.status(201).json({ message: 'Message sent', data: populated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to send message' });
  }
});

// GET /api/chat/:bookingId — get chat history
router.get('/:bookingId', verifyToken, async (req, res) => {
  try {
    const messages = await Message.find({ bookingId: req.params.bookingId })
      .populate('senderId', 'name profileImage')
      .sort({ timestamp: 1 });

    // Mark messages as read for current user
    await Message.updateMany(
      { bookingId: req.params.bookingId, senderId: { $ne: req.user.userId }, read: false },
      { read: true }
    );

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

module.exports = router;
