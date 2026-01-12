const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    hasLicense: { type: Boolean, default: false },
    myReferralCode: { type: String, unique: true }, // Saját MLM kód
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
module.exports = User;