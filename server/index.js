const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const admin = require('firebase-admin');
const rateLimit = require('express-rate-limit');

const allowedOrigins = [
  'https://traverse-unicab.vercel.app',
  'https://traverse-unicab-backend-2df13b58c562.herokuapp.com',
  'http://localhost:3000'
];

const authRoutes = require('./routes/auth');
const rideRoutes = require('./routes/rides');

// Initialize Firebase Admin
try {
  if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PROJECT_ID) {
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
  } else {
    console.warn('⚠️ Firebase credentials not found in env');
  }
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
if (!process.env.MONGO_URI) {
  console.error('❌ CRITICAL: MONGO_URI is not defined in environment variables!');
} else {
  console.log('🔄 Connecting to MongoDB...');
}

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 8000,
  maxPoolSize: 10
})
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch(err => {
    console.error('❌ MongoDB initial connection error:', err.message);
  });

mongoose.connection.on('connected', () => console.log('✅ Mongoose connected to DB'));
mongoose.connection.on('error', (err) => console.error('❌ Mongoose connection error:', err.message));
mongoose.connection.on('disconnected', () => console.warn('⚠️ Mongoose connection disconnected'));

// Health check endpoint for monitoring Heroku + DB status
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatusMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const dbStatus = dbStatusMap[dbState] || 'unknown';
  
  res.status(dbState === 1 ? 200 : 503).json({
    status: dbState === 1 ? 'healthy' : 'degraded',
    uptime: Math.floor(process.uptime()),
    database: dbStatus,
    mongoConfigured: !!process.env.MONGO_URI,
    timestamp: new Date().toISOString()
  });
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join', ({ userId, role, vehicleType }) => {
    if (userId) {
      socket.join(userId.toString());
      console.log(`${role || 'user'} ${userId} joined room`);
      if (vehicleType) {
        const cleanType = vehicleType.toString().replace(/ /g, '+').trim();
        socket.join(`vehicle:${cleanType}`);
        console.log(`Socket joined vehicle:${cleanType}`);
      }
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

// Trust proxy for Heroku / Cloud deployment
app.set('trust proxy', 1);

// General API rate limit - generous limit for campus WiFi shared IPs (5000 req / 15 mins)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  message: { message: 'Too many requests, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false
});

// Strict login rate limit - 15 attempts per 15 mins per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { message: 'Too many login attempts, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false
});

// Register rate limit - 10 registrations per hour per IP
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { message: 'Too many registration attempts, please try again after an hour' },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply general limiter to all API routes
app.use('/api/', apiLimiter);

// Apply strict limiter specifically to auth routes
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth/forgot-password', loginLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);

app.get('/', (req, res) => res.send('Traverse API running'));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err.message);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error'
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));