const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    hasLicense: { type: Boolean, default: false },
    licenseExpires: { type: Date, default: null },
    startingCapital: { type: Number, default: 0 },
    currentCapital: { type: Number, default: 0 },
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);