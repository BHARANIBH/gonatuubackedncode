require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make io accessible to routes
app.set('io', io);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/chefs', require('./routes/chefs'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/notifications', require('./routes/notifications'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Socket.IO
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join:chef', (chefId) => {
    socket.join(`chef:${chefId}`);
    socket.join('all_chefs');
    console.log(`Chef ${chefId} joined room`);
  });

  socket.on('join:all_chefs', () => {
    socket.join('all_chefs');
    console.log(`Socket ${socket.id} joined all_chefs room`);
  });

  socket.on('join:customer', (userId) => {
    socket.join(`customer:${userId}`);
    console.log(`Customer ${userId} joined room`);
  });

  socket.on('join:booking', (bookingId) => {
    socket.join(`booking:${bookingId}`);
    console.log(`Joined booking room ${bookingId}`);
  });

  socket.on('join:chat', (bookingId) => {
    socket.join(`chat:${bookingId}`);
    console.log(`Joined chat room ${bookingId}`);
  });

  socket.on('leave:booking', (bookingId) => {
    socket.leave(`booking:${bookingId}`);
  });

  socket.on('leave:chat', (bookingId) => {
    socket.leave(`chat:${bookingId}`);
  });

  socket.on('chef:location:update', ({ bookingId, lat, lng }) => {
    io.to(`booking:${bookingId}`).emit('chef:location', { lat, lng });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
