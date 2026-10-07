const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Ride = require('../models/Ride');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const crypto = require('crypto');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const sanitizeName = (name) => {
  if (!name) return '';
  return name
    .replace(/</g, '')
    .replace(/>/g, '')
    .replace(/&/g, '')
    .replace(/"/g, '')
    .replace(/'/g, '')
    .replace(/\//g, '')
    .replace(/\\/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .replace(/href=/gi, '')
    .replace(/src=/gi, '')
    .trim()
    .substring(0, 50); // Max 50 characters for name
};

const sanitizePhone = (phone) => {
  if (!phone) return '';
  return phone.replace(/[^0-9+\-\s]/g, '').substring(0, 15);
};

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, role, vehicleType } = req.body;

    const cleanName = sanitizeName(req.body.name);

    // Check if original had HTML/script tags
    const hasHtmlTags = /<[^>]*>/g.test(req.body.name || '');
    const hasJsProtocol = /javascript:/gi.test(req.body.name || '');
    const hasEventHandlers = /on\w+\s*=/gi.test(req.body.name || '');

    if (hasHtmlTags || hasJsProtocol || hasEventHandlers) {
      return res.status(400).json({ 
        message: 'Invalid characters in name. Please use only letters and spaces.' 
      });
    }

    const cleanStudentId = sanitizeName(req.body.studentId);
    const cleanVehicleNumber = sanitizeName(req.body.vehicleNumber);
    const cleanCarName = sanitizeName(req.body.carName);
    const cleanCarModel = sanitizeName(req.body.carModel);
    const cleanPhone = sanitizePhone(req.body.phone);

    // Email validation
    if (role === 'student' && !email.endsWith('@juitsolan.in')) {
      return res.status(400).json({ message: 'Students must register with their JUIT email (@juitsolan.in)' });
    }
    if (role === 'faculty' && !email.endsWith('@juitsolan.in')) {
      return res.status(400).json({ message: 'Faculty must register with their JUIT email (@juitsolan.in)' });
    }
    if (role === 'driver' && email.endsWith('@juitsolan.in')) {
      return res.status(400).json({ message: 'Drivers must register with a personal email' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = new User({
      name: cleanName,
      email,
      password,
      role,
      studentId: cleanStudentId,
      vehicleNumber: cleanVehicleNumber,
      phone: cleanPhone,
      carName: cleanCarName,
      carModel: cleanCarModel,
      vehicleType,
      verificationToken,
      verificationExpiry,
      isVerified: false
    });
    await user.save();

    // Send verification email only for students and faculty
    if (role !== 'driver') {
      await sendVerificationEmail(email, cleanName, verificationToken);
      return res.status(201).json({
        message: 'Registration successful! Please check your email to verify your account.'
      });
    } else {
      return res.status(201).json({
        message: 'Registration successful! Your account is pending admin verification.'
      });
    }
  } catch (error) {
    console.log('Register error:', error.message);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
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
    if (user.isBlocked) {
      return res.status(403).json({
        message: 'Your account has been blocked by admin. Please email traverseuni@gmail.com to resolve.'
      });
    }

    // Check if account is locked
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({ 
        message: `Account locked due to too many failed attempts. Try again in ${minutesLeft} minutes.` 
      });
    }

    // Check if email is verified
    if (!user.isVerified && user.role !== 'driver') {
      return res.status(401).json({
        message: 'Please verify your email first. Check your inbox for the verification link.'
      });
    }

    // Check if driver is pending admin verification
    if (!user.isVerified && user.role === 'driver') {
      return res.status(401).json({
        message: 'Your account is pending admin verification. Please wait for approval.'
      });
    }
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 30 * 60 * 1000); // Lock 30 mins
        user.loginAttempts = 0; // Reset counter
        await user.save();
        return res.status(423).json({ 
          message: 'Account locked for 30 minutes due to too many failed attempts.' 
        });
      }
      await user.save();
      return res.status(401).json({ 
        message: `Invalid credentials. ${5 - user.loginAttempts} attempts remaining before lockout.` 
      });
    }

    // Reset login attempts on successful login
    user.loginAttempts = 0;
    user.lockUntil = null;

    // Generate unique session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    user.sessionToken = sessionToken;
    await user.save();

    return res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      vehicleType: user.vehicleType,
      vehicleNumber: user.vehicleNumber,
      phone: user.phone,
      token: generateToken(user._id)
    });
  } catch (error) {
    console.log('Login error:', error.message);
    return res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});
// Admin - get platform overview statistics
router.get('/admin/stats', adminOnly, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.id !== 'admin') {
      const user = await User.findById(decoded.id);
      if (!user || user.email !== process.env.ADMIN_EMAIL) {
        return res.status(401).json({ message: 'Not authorized' });
      }
    }

    const [
      totalStudents,
      totalFaculty,
      totalDrivers,
      pendingDrivers,
      blockedUsers,
      totalRides,
      activeRides,
      completedRides,
      cancelledRides,
      revenueResult
    ] = await Promise.all([
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'faculty' }),
      User.countDocuments({ role: 'driver' }),
      User.countDocuments({ role: 'driver', isVerified: false }),
      User.countDocuments({ isBlocked: true }),
      Ride.countDocuments({}),
      Ride.countDocuments({ status: { $in: ['searching', 'accepted', 'ontheway'] } }),
      Ride.countDocuments({ status: 'completed' }),
      Ride.countDocuments({ status: 'cancelled' }),
      Ride.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$fare' } } }
      ])
    ]);

    const totalRevenue = revenueResult && revenueResult.length > 0 ? revenueResult[0].total : 0;

    res.json({
      totalStudents,
      totalFaculty,
      totalDrivers,
      pendingDrivers,
      blockedUsers,
      totalRides,
      activeRides,
      completedRides,
      cancelledRides,
      totalRevenue
    });
  } catch (error) {
    console.error('Admin stats error:', error.message);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// Admin - get paginated users with robust search and role/status filtering
router.get('/admin/users', adminOnly, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.id !== 'admin') {
      const user = await User.findById(decoded.id);
      if (!user || user.email !== process.env.ADMIN_EMAIL) {
        return res.status(401).json({ message: 'Not authorized' });
      }
    }

    const { search = '', page = 1, limit = 15, role, statusFilter } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 15);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (role && role !== 'all') {
      filter.role = role;
    }

    if (statusFilter === 'pending') {
      filter.isVerified = false;
    } else if (statusFilter === 'blocked') {
      filter.isBlocked = true;
    } else if (statusFilter === 'active') {
      filter.isBlocked = { $ne: true };
    } else if (statusFilter === 'at_risk') {
      filter.cancelCount = { $gte: 3 };
      filter.isBlocked = { $ne: true };
    }

    if (search && search.trim()) {
      const q = search.trim();
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } },
        { studentId: { $regex: q, $options: 'i' } },
        { vehicleNumber: { $regex: q, $options: 'i' } },
        { carName: { $regex: q, $options: 'i' } },
        { carModel: { $regex: q, $options: 'i' } },
        { vehicleType: { $regex: q, $options: 'i' } }
      ];
    }

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('-password -fcmToken -sessionToken -resetPasswordToken -verificationToken -loginAttempts -lockUntil')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    res.json({
      users,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      limit: limitNum
    });
  } catch (error) {
    console.error('Admin users error:', error.message);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// Admin - block/unblock user
router.put('/admin/block/:id', adminOnly, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.id !== 'admin') {
      const user = await User.findById(decoded.id);
      if (!user || user.email !== process.env.ADMIN_EMAIL) {
        return res.status(401).json({ message: 'Not authorized' });
      }
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.isBlocked = !user.isBlocked;
    await user.save();

    const sanitizedUser = user.toObject();
    delete sanitizedUser.password;
    delete sanitizedUser.fcmToken;
    delete sanitizedUser.sessionToken;
    delete sanitizedUser.resetPasswordToken;
    delete sanitizedUser.verificationToken;
    delete sanitizedUser.loginAttempts;
    delete sanitizedUser.lockUntil;

    res.json({ message: `User ${user.isBlocked ? 'blocked' : 'unblocked'}`, user: sanitizedUser });
  } catch (error) {
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// Admin - verify driver
router.put('/admin/verify/:id', adminOnly, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.id !== 'admin') {
      const user = await User.findById(decoded.id);
      if (!user || user.email !== process.env.ADMIN_EMAIL) {
        return res.status(401).json({ message: 'Not authorized' });
      }
    }

    const driver = await User.findByIdAndUpdate(
      req.params.id,
      { isVerified: true },
      { new: true }
    ).select('-password -fcmToken -sessionToken -resetPasswordToken -verificationToken -loginAttempts -lockUntil');

    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    res.json({ message: 'Driver verified successfully', driver });
  } catch (error) {
    console.log('Verify error:', error.message);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// Admin - toggle driver online/offline availability
router.put('/admin/toggle-availability/:id', adminOnly, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.id !== 'admin') {
      const user = await User.findById(decoded.id);
      if (!user || user.email !== process.env.ADMIN_EMAIL) {
        return res.status(401).json({ message: 'Not authorized' });
      }
    }

    const driver = await User.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    if (driver.role !== 'driver') return res.status(400).json({ message: 'User is not a driver' });

    driver.isAvailable = !driver.isAvailable;
    await driver.save();

    const sanitizedDriver = driver.toObject();
    delete sanitizedDriver.password;
    delete sanitizedDriver.fcmToken;
    delete sanitizedDriver.sessionToken;
    delete sanitizedDriver.resetPasswordToken;
    delete sanitizedDriver.verificationToken;
    delete sanitizedDriver.loginAttempts;
    delete sanitizedDriver.lockUntil;

    res.json({
      message: `Driver status changed to ${driver.isAvailable ? 'Online' : 'Offline'}`,
      isAvailable: driver.isAvailable,
      driver: sanitizedDriver
    });
  } catch (error) {
    console.log('Admin toggle availability error:', error.message);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// Get current user
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -fcmToken -sessionToken -resetPasswordToken -verificationToken -loginAttempts -lockUntil');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// Verify email
router.get('/verify-email/:token', async (req, res) => {
  try {
    const user = await User.findOne({
      verificationToken: req.params.token,
      verificationExpiry: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial; background: #0a0a0a; color: white; text-align: center; padding: 60px;">
            <h1 style="color: #e63946;">❌ Invalid or Expired Link</h1>
            <p style="color: #999;">This verification link has expired. Please register again.</p>
            <a href="https://traverse-unicab.vercel.app/register" style="color: #e63946;">Go to Register</a>
          </body>
        </html>
      `);
    }

    user.isVerified = true;
    user.verificationToken = null;
    user.verificationExpiry = null;
    await user.save();

    return res.send(`
      <html>
        <body style="font-family: Arial; background: #0a0a0a; color: white; text-align: center; padding: 60px;">
          <h1 style="color: #10b981;">✅ Email Verified!</h1>
          <p style="color: #999;">Your Traverse-Unicab account is now active.</p>
          <a href="https://traverse-unicab.vercel.app/login" 
             style="background: #e63946; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
            Login Now
          </a>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isVerified) return res.status(400).json({ message: 'Already verified' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    user.verificationToken = verificationToken;
    user.verificationExpiry = verificationExpiry;
    await user.save();

    await sendVerificationEmail(email, user.name, verificationToken);
    res.json({ message: 'Verification email sent!' });
  } catch (error) {
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// Forgot password - send reset email
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'No account found with this email' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiry = resetExpiry;
    await user.save();

    await sendPasswordResetEmail(email, user.name, resetToken);

    res.json({ message: 'Password reset email sent! Check your inbox.' });
  } catch (error) {
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// Reset password
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { password } = req.body;
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpiry: { $gt: new Date() }
    });

    if (!user) return res.status(400).json({ message: 'Invalid or expired reset link' });

    user.password = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpiry = null;
    await user.save();

    res.json({ message: 'Password reset successful! You can now login.' });
  } catch (error) {
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

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
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

router.post('/logout', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { sessionToken: null });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// Save FCM token
router.post('/save-token', protect, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    console.log('Saving FCM token for user:', req.user._id, 'token:', fcmToken ? 'exists' : 'null');
    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    res.json({ message: 'Token saved' });
  } catch (error) {
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;