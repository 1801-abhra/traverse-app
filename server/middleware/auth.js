const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        return res.status(401).json({ message: 'User not found' });
      }

      // Check session token
      const sessionToken = req.headers['x-session-token'];
      if (user.role !== 'admin' && sessionToken && user.sessionToken &&
        user.sessionToken !== sessionToken) {
        return res.status(401).json({
          message: 'SESSION_EXPIRED',
          reason: 'You have been logged in from another device. Please login again.'
        });
      }

      req.user = user;
      return next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
};

module.exports = { protect };