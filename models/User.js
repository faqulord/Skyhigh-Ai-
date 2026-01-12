const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    date: { type: Date, default: Date.now },
    
    // LICENC ADATOK
    hasLicense: { type: Boolean, default: false },
    licenseType: { type: String, default: 'none' },
    licenseExpires: { type: Date, default: null },
    totalSpent: { type: Number, default: 0 },
    
    // PÉNZÜGYI MENEDZSMENT (ROBOT KEZELI)
    startingCapital: { type: Number, default: 0 }, // Kezdőtőke
    currentCapital: { type: Number, default: 0 },  // Aktuális egyenleg
    
    myReferralCode: { type: String, default: '' }
});

module.exports = mongoose.model('User', UserSchema);