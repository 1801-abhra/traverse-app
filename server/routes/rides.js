const express = require('express');
const Ride = require('../models/Ride');
const { protect } = require('../middleware/auth');
const router = express.Router();

// Book a ride (student)
router.post('/book', protect, async (req, res) => {
  try {
    const { pickup, dropoff } = req.body;
    const ride = await Ride.create({
      student: req.user._id,
      pickup,
      dropoff,
      status: 'searching'
    });
    // Notify all drivers
    req.io.emit('new:ride', ride);
    res.status(201).json(ride);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get available rides (driver)
router.get('/available', protect, async (req, res) => {
  try {
    const rides = await Ride.find({ status: 'searching' })
      .populate('student', 'name email studentId')
      .populate('sharedWith', 'name studentId');
    res.json(rides);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Accept ride (driver)
router.put('/accept/:id', protect, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (ride.status !== 'searching') {
      return res.status(400).json({ message: 'Ride no longer available' });
    }
    ride.driver = req.user._id;
    ride.status = 'accepted';
    await ride.save();
    const populated = await ride.populate('driver', 'name vehicleNumber phone');
    await populated.populate('student', 'name');

    // Notify original student
    req.io.to(ride.student.toString()).emit('ride:accepted', populated);

    // Notify shared student if exists
    if (ride.sharedWith) {
      req.io.to(ride.sharedWith.toString()).emit('ride:accepted', populated);
    }
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update ride status (driver)
router.put('/status/:id', protect, async (req, res) => {
  try {
    const { status } = req.body;
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    ride.status = status;
    await ride.save();
    // Notify original student
    req.io.to(ride.student.toString()).emit('ride:updated', ride);
    // Notify shared student if exists
    if (ride.sharedWith) {
      req.io.to(ride.sharedWith.toString()).emit('ride:updated', ride);
    }
    res.json(ride);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Cancel ride (student)
router.put('/cancel/:id', protect, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (ride.status !== 'searching') {
      return res.status(400).json({ message: 'Cannot cancel after driver accepted' });
    }
    ride.status = 'cancelled';
    await ride.save();
    res.json(ride);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Ride history
router.get('/history', protect, async (req, res) => {
  try {
    const query = req.user.role === 'student'
      ? { student: req.user._id }
      : { driver: req.user._id };
    const rides = await Ride.find(query)
      .populate('student', 'name')
      .populate('driver', 'name vehicleNumber phone')
      .sort({ createdAt: -1 });
    res.json(rides);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// rate a ride student
router.put('/rate/:id', protect, async (req, res) => {
  try {
    const { rating } = req.body;
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (ride.status !== 'completed') {
      return res.status(400).json({ message: 'Can only rate completed rides' });
    }
    ride.rating = rating;
    await ride.save();
    res.json(ride);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// Get driver average rating
router.get('/my-rating', protect, async (req, res) => {
  try {
    const rides = await Ride.find({
      driver: req.user._id,
      rating: { $ne: null }
    });
    if (rides.length === 0) {
      return res.json({ average: 0, total: 0 });
    }
    const total = rides.length;
    const sum = rides.reduce((acc, ride) => acc + ride.rating, 0);
    const average = (sum / total).toFixed(1);
    res.json({ average, total });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// Admin - get all rides
router.get('/admin/rides', async (req, res) => {
  try {
    const rides = await Ride.find()
      .populate('student', 'name email studentId phone')
      .populate('driver', 'name email vehicleNumber phone')
      .sort({ createdAt: -1 });
    res.json(rides);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin - cancel any ride
router.put('/admin/cancel/:id', async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    ride.status = 'cancelled';
    await ride.save();
    res.json(ride);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// Book shared ride
router.post('/book-shared', protect, async (req, res) => {
  try {
    const { pickup, dropoff, fare } = req.body;

    // Look for existing unmatched shared ride going same route
    const existingRide = await Ride.findOne({
      rideType: 'shared',
      isMatched: false,
      status: 'searching',
      dropoff: { $regex: dropoff, $options: 'i' }
    }).populate('student', 'name');

    if (existingRide && existingRide.student._id.toString() !== req.user._id.toString()) {
      // Match found — join existing ride
      existingRide.isMatched = true;
      existingRide.sharedWith = req.user._id;
      existingRide.fare = Math.ceil(existingRide.originalFare / 2);
      await existingRide.save();

      // Notify original student about match
      req.io.to(existingRide.student._id.toString()).emit('ride:matched', {
        message: `${req.user.name} joined your shared ride! Fare divided to ₹${existingRide.fare}`,
        ride: existingRide
      });
      // Notify second student too
      req.io.to(req.user._id.toString()).emit('ride:matched', {
        message: `Matched with ${existingRide.student.name}! Fare: ₹${existingRide.fare}`,
        ride: existingRide
      });
      return res.status(200).json({
        matched: true,
        ride: existingRide,
        message: `Matched with ${existingRide.student.name}! Fare: ₹${existingRide.fare}`
      });
    }

    // No match found — create new shared ride
    const ride = await Ride.create({
      student: req.user._id,
      pickup,
      dropoff,
      fare: Math.ceil(fare / 2),
      originalFare: fare,
      status: 'searching',
      rideType: 'shared',
      isMatched: false
    });

    req.io.emit('new:ride', ride);

    res.status(201).json({
      matched: false,
      ride,
      message: 'Looking for someone to share with...'
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get available shared rides
router.get('/shared/available', protect, async (req, res) => {
  try {
    const rides = await Ride.find({
      rideType: 'shared',
      isMatched: false,
      status: 'searching',
      student: { $ne: req.user._id }
    }).populate('student', 'name studentId');
    res.json(rides);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
module.exports = router;