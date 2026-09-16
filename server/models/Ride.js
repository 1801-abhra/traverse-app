const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  pickup: {
    type: String,
    required: true
  },
  dropoff: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['searching', 'accepted', 'ontheway', 'completed', 'cancelled'],
    default: 'searching'
  },
  fare: {
    type: Number,
    default: 0
  },
  rideType: {
    type: String,
    enum: ['private', 'shared'],
    default: 'private'
  },
  vehicleType: {
    type: String,
    enum: ['4+1', '6+1'],
    default: '4+1'
  },
  destination: {
    type: String,
    default: ''
  },
  scheduledTime: {
    type: Date,
    default: null
  },
  isScheduled: {
    type: Boolean,
    default: false
  },
  passengers: [{
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    name: String,
    phone: String
  }],
  maxPassengers: {
    type: Number,
    default: 4
  },
  isFull: {
    type: Boolean,
    default: false
  },
  isMatched: {
    type: Boolean,
    default: false
  },
  originalFare: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  }
}, { timestamps: true });

rideSchema.index({ student: 1 });
rideSchema.index({ driver: 1 });
rideSchema.index({ status: 1 });
rideSchema.index({ status: 1, vehicleType: 1 });
rideSchema.index({ status: 1, isScheduled: 1 });
rideSchema.index({ rideType: 1, status: 1, isFull: 1 });
rideSchema.index({ student: 1, status: 1 });
rideSchema.index({ driver: 1, status: 1 });
rideSchema.index({ createdAt: -1 });
rideSchema.index({ scheduledTime: 1, isScheduled: 1 });

module.exports = mongoose.model('Ride', rideSchema);