const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const admin = require('firebase-admin');

const authRoutes = require('./routes/auth');
const rideRoutes = require('./routes/rides');

// Initialize Firebase Admin
try {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    .replace(/\\n/g, '\n')
    .replace(/"/g, '');

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey
    })
  });
  console.log('Firebase initialized successfully');
} catch (error) {
  console.log('Firebase init error:', error.message);
}

const app = express();
const server = http.createServer(app);

const io = socketio(server, {
  cors: {
    origin: function (origin, callback) {
      callback(null, true);
    },
    methods: ['GET', 'POST']
  }
});

app.use(cors({
  origin: function (origin, callback) {
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-token']
}));
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB error:', err));

// Socket.io
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join', ({ userId, role }) => {
    if (userId) {
      socket.join(userId.toString());
      console.log(`${role || 'user'} ${userId} joined room`);
    }
  });

  socket.on('join:ride', (rideId) => {
    if (rideId) {
      const cleanRideId = typeof rideId === 'object' ? (rideId._id || rideId.id || rideId.toString()) : rideId.toString();
      socket.join(`ride:${cleanRideId}`);
      console.log(`Socket ${socket.id} joined ride:${cleanRideId}`);
    }
  });

  socket.on('driver:location', ({ rideId, studentId, sharedWithId, passengers, lat, lng }) => {
    if (lat === undefined || lng === undefined) return;
    
    const locationData = { rideId, lat, lng };

    // Broadcast to dedicated ride room
    if (rideId) {
      const cleanRideId = typeof rideId === 'object' ? (rideId._id || rideId.id || rideId.toString()) : rideId.toString();
      io.to(`ride:${cleanRideId}`).emit('driver:location', locationData);
    }

    const getCleanId = (id) => {
      if (!id) return null;
      if (typeof id === 'object') return id._id || id.id || id.toString();
      return id.toString();
    };

    const sid = getCleanId(studentId);
    if (sid) {
      io.to(sid).emit('driver:location', locationData);
    }

    const swid = getCleanId(sharedWithId);
    if (swid) {
      io.to(swid).emit('driver:location', locationData);
    }

    if (Array.isArray(passengers)) {
      passengers.forEach(p => {
        const pid = getCleanId(p?.student || p);
        if (pid) {
          io.to(pid).emit('driver:location', locationData);
        }
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// Make io and admin accessible in routes
app.use((req, res, next) => {
  req.io = io;
  req.admin = admin;
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);

app.get('/', (req, res) => res.send('Traverse API running'));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));