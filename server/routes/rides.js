const express = require('express');
const Ride = require('../models/Ride');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const router = express.Router();
const sendPushNotification = async (admin, fcmToken, title, body) => {
  if (!fcmToken) return;
  try {
    await admin.messaging().send({
      token: fcmToken,
      data: { title, body },
      webpush: {
        data: { title, body }
      }
    });
    console.log('Push sent successfully!');
  } catch (error) {
    console.log('Push notification error:', error.message);
    if (error.message.includes('unregistered') || error.message.includes('invalid')) {
      try {
        await User.updateOne({ fcmToken }, { fcmToken: null });
        console.log('Cleared invalid FCM token');
      } catch (e) {
        console.log('Error clearing token:', e.message);
      }
    }
  }
};
// Book a ride (student)
router.post('/book', protect, async (req, res) => {
  try {
    const existingRide = await Ride.findOne({
      student: req.user._id,
      status: { $in: ['searching', 'accepted', 'ontheway'] }
    });
    if (existingRide) {
      return res.status(400).json({ message: 'You already have an active ride' });
    }

    const { pickup, dropoff, fare, scheduledTime, vehicleType } = req.body;
    const ride = await Ride.create({
      student: req.user._id,
      pickup,
      dropoff,
      fare,
      status: 'searching',
      vehicleType: vehicleType || '4+1',
      isScheduled: scheduledTime ? true : false,
      scheduledTime: scheduledTime || null
    });

    const populatedRide = await Ride.findById(ride._id)
      .populate('student', 'name email studentId');
    req.io.emit('new:ride', populatedRide);

    // Notify drivers with matching vehicle type
    const drivers = await User.find({
      role: 'driver',
      vehicleType: vehicleType || '4+1',
      fcmToken: { $ne: null }
    });
    for (const driver of drivers) {
      await sendPushNotification(
        req.admin,
        driver.fcmToken,
        '🔔 New Ride Request!',
        `${pickup} → ${dropoff}`
      );
    }

    res.status(201).json(ride);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// Get available rides (driver)
router.get('/available', protect, async (req, res) => {
  try {
    const driver = await User.findById(req.user._id);
    const rides = await Ride.find({
      status: 'searching',
      vehicleType: driver.vehicleType,
      isScheduled: { $ne: true }
    })
      .populate('student', 'name email studentId')
      .populate('sharedWith', 'name studentId');
    res.json(rides);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// Toggle driver availability
router.put('/toggle-availability', protect, async (req, res) => {
  try {
    const driver = await User.findById(req.user._id);
    driver.isAvailable = !driver.isAvailable;
    await driver.save();
    res.json({ isAvailable: driver.isAvailable });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get active ride for driver
router.get('/driver-active', protect, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const ride = await Ride.findOne({
      driver: req.user._id,
      status: { $in: ['accepted', 'ontheway'] }
    })
      .populate('student', 'name email studentId phone')
      .populate('driver', 'name vehicleNumber phone');
    res.json(ride || null);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Check driver availability for students
router.get('/drivers-available', protect, async (req, res) => {
  try {
    const { vehicleType } = req.query;
    const availableDrivers = await User.find({
      role: 'driver',
      isAvailable: true,
      vehicleType: vehicleType || '4+1'
    });
    res.json({ available: availableDrivers.length > 0, count: availableDrivers.length });
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
    // Check if driver already has active ride
    const driverActiveRide = await Ride.findOne({
      driver: req.user._id,
      status: { $in: ['accepted', 'ontheway'] }
    });
    if (driverActiveRide) {
      return res.status(400).json({ message: 'You already have an active ride' });
    }
    ride.driver = req.user._id;
    ride.status = 'accepted';
    await ride.save();
    const populated = await Ride.findById(ride._id)
      .populate('driver', 'name vehicleNumber phone carName carModel')
      .populate('student', 'name email studentId phone')
      .populate('sharedWith', 'name');
    req.io.to(ride.student.toString()).emit('ride:accepted', populated);
    if (ride.sharedWith) {
      req.io.to(ride.sharedWith.toString()).emit('ride:accepted', populated);
    }
    res.json(populated);
    // Send push to student
    const student = await User.findById(ride.student);
    if (student?.fcmToken) {
      await sendPushNotification(
        req.admin,
        student.fcmToken,
        '🚗 Driver Accepted!',
        `${req.user.name} is on the way. Vehicle: ${req.user.vehicleNumber}`
      );
    }
  } catch (error) {
    console.log('Accept error:', error.message);
    res.status(500).json({ message: error.message });
  }
});
// Reject a Ride
router.put('/reject/:id', protect, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    ride.status = 'searching';
    ride.driver = null;
    await ride.save();
    res.json({ message: 'Ride rejected' });
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
    const student = await User.findById(ride.student);
    if (ride.status === 'ontheway' && student?.fcmToken) {
      await sendPushNotification(
        req.admin,
        student.fcmToken,
        '🚖 Driver On The Way!',
        'Your driver is heading to your pickup location'
      );
    }
    if (ride.status === 'completed' && student?.fcmToken) {
      await sendPushNotification(
        req.admin,
        student.fcmToken,
        '✅ Ride Completed!',
        'Hope you had a great ride! Please rate your experience.'
      );
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Cancel ride (student)
router.put('/cancel/:id', protect, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id).populate('student', 'name');
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (ride.status !== 'searching') {
      return res.status(400).json({ message: 'Cannot cancel after driver accepted' });
    }

    // Check if canceller is the sharedWith student
    if (ride.rideType === 'shared' && ride.sharedWith &&
      ride.sharedWith.toString() === req.user._id.toString()) {
      // Second student cancels - just remove them from shared ride
      ride.sharedWith = null;
      ride.isMatched = false;
      ride.fare = ride.originalFare || ride.fare * 2;
      await ride.save();

      // Notify first student
      req.io.to(ride.student._id.toString()).emit('ride:shared-cancelled', {
        message: 'Your shared ride partner cancelled. You can find a new match or continue alone.'
      });

      return res.json({ message: 'Left shared ride successfully', ride });
    }

    // Regular cancel — cancel entire ride
    ride.status = 'cancelled';
    await ride.save();
    req.io.emit('ride:cancelled', { rideId: ride._id.toString() });

    // Notify sharedWith student if exists
    if (ride.sharedWith) {
      req.io.to(ride.sharedWith.toString()).emit('ride:shared-cancelled', {
        message: 'The original student cancelled the shared ride.'
      });
    }

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
    const activeRide = await Ride.findOne({
      student: req.user._id,
      status: { $in: ['searching', 'accepted', 'ontheway'] }
    });
    if (activeRide) {
      return res.status(400).json({ message: 'You already have an active ride' });
    }

    const { pickup, dropoff, fare, vehicleType, scheduledTime } = req.body;

    const ride = await Ride.create({
      student: req.user._id,
      pickup,
      dropoff,
      fare,
      originalFare: fare,
      status: 'searching',
      rideType: 'shared',
      vehicleType: vehicleType || '4+1',
      isMatched: false,
      isScheduled: scheduledTime ? true : false,
      scheduledTime: scheduledTime || null
    });
    req.io.emit('new:ride', ride);
    // Notify available drivers
    const drivers = await User.find({
      role: 'driver',
      vehicleType: vehicleType || '4+1',
      isAvailable: true,
      fcmToken: { $ne: null }
    });
    for (const driver of drivers) {
      await sendPushNotification(
        req.admin,
        driver.fcmToken,
        '🔔 New Ride Request!',
        `${pickup} → ${dropoff}`
      );
    }

    const availableMatches = await Ride.find({
      rideType: 'shared',
      isMatched: false,
      status: 'searching',
      vehicleType: vehicleType || '4+1',
      student: { $ne: req.user._id }
    }).populate('student', 'name');

    return res.status(201).json({
      matched: false,
      ride,
      availableMatches,
      message: availableMatches.length > 0
        ? `${availableMatches.length} person(s) going your way!`
        : 'Looking for someone to share with...'
    });

  } catch (error) {
    console.log('book-shared error:', error.message);
    ~res.status(500).json({ message: error.message });
  }
});
// Join existing shared ride
router.put('/join-shared/:id', protect, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id).populate('student', 'name');
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (ride.isMatched) return res.status(400).json({ message: 'Ride already matched' });

    ride.isMatched = true;
    ride.sharedWith = req.user._id;
    ride.fare = Math.ceil(ride.originalFare / 2);
    await ride.save();

    req.io.to(ride.student._id.toString()).emit('ride:matched', {
      message: `${req.user.name} joined your shared ride! Fare divided to ₹${ride.fare}`,
      ride
    });
    req.io.to(req.user._id.toString()).emit('ride:matched', {
      message: `Matched with ${ride.student.name}! Fare: ₹${ride.fare}`,
      ride
    });

    res.json({ matched: true, ride, message: `Matched with ${ride.student.name}! Fare: ₹${ride.fare}` });
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
// Get active ride for student
router.get('/active', protect, async (req, res) => {
  try {
    const ride = await Ride.findOne({
      student: req.user._id,
      status: { $in: ['searching', 'accepted', 'ontheway'] }
    })
      .populate('driver', 'name vehicleNumber phone carName carModel')
      .populate('student', 'name email studentId phone');
    res.json(ride || null);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// Cancel accepted ride (both student and driver)
router.put('/cancel-accepted/:id', protect, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (ride.status !== 'accepted') {
      return res.status(400).json({ message: 'Can only cancel accepted rides' });
    }

    const driverId = ride.driver;
    const studentId = ride.student;

    // Increment cancel count
    await User.findByIdAndUpdate(req.user._id, { $inc: { cancelCount: 1 } });
    const user = await User.findById(req.user._id);

    if (user.cancelCount >= 5) {
      // Admin will block manually from admin panel
      console.log(`User ${req.user._id} has reached 5 cancellations - admin review needed`);
    }


    // Cancel the ride completely
    ride.status = 'cancelled';
    ride.driver = null;
    await ride.save();

    // Notify student - ride is cancelled
    req.io.to(studentId.toString()).emit('ride:cancelled-by-party', {
      message: 'Ride cancelled successfully.'
    });

    // Notify driver - ride was cancelled by student
    if (driverId) {
      req.io.to(driverId.toString()).emit('ride:cancelled-by-party', {
        message: 'Student cancelled the ride.'
      });
    }

    // Send push to driver
    if (driverId) {
      const driver = await User.findById(driverId);
      if (driver?.fcmToken) {
        await sendPushNotification(
          req.admin,
          driver.fcmToken,
          '❌ Ride Cancelled',
          'The student has cancelled the ride.'
        );
      }
    }

    res.json({
      message: 'Ride cancelled',
      cancelCount: user.cancelCount,
      warning: user.cancelCount >= 3 ? `Warning: ${5 - user.cancelCount} cancellations left before blacklist` : null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// Pre-accept scheduled ride (driver)
router.put('/pre-accept/:id', protect, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (!ride.isScheduled) return res.status(400).json({ message: 'Not a scheduled ride' });
    if (ride.driver) return res.status(400).json({ message: 'Ride already pre-accepted by another driver' });

    ride.driver = req.user._id;
    await ride.save();

    const populated = await Ride.findById(ride._id)
      .populate('driver', 'name vehicleNumber phone')
      .populate('student', 'name phone studentId');

    // Notify student
    req.io.to(ride.student.toString()).emit('ride:pre-accepted', {
      message: `Driver ${req.user.name} will pick you up at scheduled time!`,
      ride: populated
    });

    // Send push to student
    const student = await User.findById(ride.student);
    if (student?.fcmToken) {
      await sendPushNotification(
        req.admin,
        student.fcmToken,
        '✅ Scheduled Ride Confirmed!',
        `${req.user.name} will pick you up at the scheduled time`
      );
    }

    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get scheduled rides for driver
router.get('/scheduled', protect, async (req, res) => {
  try {
    const driver = await User.findById(req.user._id);
    const rides = await Ride.find({
      isScheduled: true,
      status: 'searching',
      vehicleType: driver.vehicleType,
      scheduledTime: { $gte: new Date() }
    })
      .populate('student', 'name phone studentId')
      .sort({ scheduledTime: 1 });
    res.json(rides);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get driver's pre-accepted scheduled rides
router.get('/my-scheduled', protect, async (req, res) => {
  try {
    const rides = await Ride.find({
      driver: req.user._id,
      isScheduled: true,
      status: 'searching'
    })
      .populate('student', 'name phone studentId')
      .sort({ scheduledTime: 1 });
    res.json(rides);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
module.exports = router;