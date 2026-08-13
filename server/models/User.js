const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'driver', 'faculty'], required: true },
  studentId: { type: String, default: '' },
  vehicleNumber: { type: String, default: '' },
  phone: { type: String, default: '' },
  carName: { type: String, default: '' },
  carModel: { type: String, default: '' },
  vehicleType: {
    type: String,
    enum: ['4+1', '6+1'],
    default: '4+1'
  },
  fcmToken: {
    type: String,
    default: null
  },

  isAvailable: { type: Boolean, default: true },
  cancelCount: {
    type: Number,
    default: 0
  },
  isBlocked: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
