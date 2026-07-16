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
  sharedWith: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
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

module.exports = mongoose.model('Ride', rideSchema);