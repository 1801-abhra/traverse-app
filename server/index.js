const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const admin = require('firebase-admin');

// Initialize Firebase Admin
try {
  if (!admin.apps || !admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY ?
          process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : ''
      })
    });
  }
} catch (error) {
  console.log('Firebase init error:', error.message);
}

const authRoutes = require('./routes/auth');
const rideRoutes = require('./routes/rides');

const app = express();
const server = http.createServer(app);

// Make admin accessible in routes
app.use((req, res, next) => {
  req.admin = admin;
  next();
});

const authRoutes = require('./routes/auth');
const rideRoutes = require('./routes/rides');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'http://localhost:3000',
  'https://traverse-client.vercel.app',
  'https://traverse-unicab.vercel.app',
  process.env.CLIENT_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

const io = socketio(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
    socket.join(userId);
    console.log(`${role} ${userId} joined room`);
  });

  socket.on('driver:location', ({ rideId, studentId, sharedWithId, lat, lng }) => {
    io.to(studentId).emit('driver:location', { lat, lng });
    if (sharedWithId) {
      io.to(sharedWithId).emit('driver:location', { lat, lng });
    }
  });
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });


});

// Make io accessible in routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);

app.get('/', (req, res) => res.send('Traverse API running'));

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));