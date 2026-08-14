const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();
const { protect } = require('../middleware/auth');
const crypto = require('crypto');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');
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
      name, email, password, role, studentId, vehicleNumber,
      phone, carName, carModel, vehicleType,
      verificationToken,
      verificationExpiry,
      isVerified: false
    });
    await user.save();

    // Send verification email only for students and faculty
    if (role !== 'driver') {
      await sendVerificationEmail(email, name, verificationToken);
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
    if (user.isBlocked) {
      return res.status(403).json({
        message: 'Your account has been blocked by admin. Please email traverseuni@gmail.com to resolve.'
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
router.put('/admin/verify/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Admin token has id === 'admin'
    if (decoded.id !== 'admin') {
      return res.status(401).json({ message: 'Not authorized' });
    }

    await User.findByIdAndUpdate(req.params.id, { isVerified: true });
    res.json({ message: 'Driver verified successfully' });
  } catch (error) {
    console.log('Verify error:', error.message);
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
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
  }
});

// Verify driver (admin)
router.put('/admin/verify/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if admin
    if (decoded.id !== 'admin') {
      const user = await User.findById(decoded.id);
      if (!user || user.email !== process.env.ADMIN_EMAIL) {
        return res.status(401).json({ message: 'Not authorized' });
      }
    }

    await User.findByIdAndUpdate(req.params.id, { isVerified: true });
    res.json({ message: 'Driver verified successfully' });
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