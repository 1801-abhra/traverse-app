const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();
const { protect } = require('../middleware/auth');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, studentId, vehicleNumber, phone, carName, carModel, vehicleType } = req.body;

    // Email validation
    if (role === 'student' && !email.endsWith('@juitsolan.in')) {
      return res.status(400).json({ message: 'Students must register with their JUIT email (@juitsolan.in)' });
    }
    if (role === 'driver' && email.endsWith('@juitsolan.in')) {
      return res.status(400).json({ message: 'Drivers must register with a personal email' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = new User({ name, email, password, role, studentId, vehicleNumber, phone, carName, carModel, vehicleType });
    await user.save();
    return res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id)
    });
  } catch (error) {
    console.log('Register error:', error.message);
    return res.status(500).json({ message: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    if (user.role === 'student' && !email.endsWith('@juitsolan.in')) {
      return res.status(401).json({ message: 'Students must use their JUIT email' });
    }
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    return res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id)
    });
  } catch (error) {
    console.log('Login error:', error.message);
    return res.status(500).json({ message: error.message });
  }
});
// Admin - get all users
router.get('/admin/users', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin - block/unblock user
router.put('/admin/block/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.isBlocked = !user.isBlocked;
    await user.save();
    res.json({ message: `User ${user.isBlocked ? 'blocked' : 'unblocked'}`, user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// Admin login
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      return res.json({
        name: 'Admin',
        email,
        role: 'admin',
        token: generateToken('admin')
      });
    }
    return res.status(401).json({ message: 'Invalid admin credentials' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get current user
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
// Save FCM token
router.post('/save-token', protect, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    console.log('Saving FCM token for user:', req.user._id, 'token:', fcmToken ? 'exists' : 'null');
    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    res.json({ message: 'Token saved' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});