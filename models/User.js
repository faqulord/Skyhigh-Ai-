const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    
    // LICENC ADATOK
    hasLicense: { type: Boolean, default: false },
    licenseExpires: { type: Date, default: null },
    
    // BANK MENEDZSMENT & KORLÁTOK
    startingCapital: { type: Number, default: 0 }, // Kezdőtőke
    currentCapital: { type: Number, default: 0 },  // Aktuális egyenleg
    freeMessagesCount: { type: Number, default: 0 }, // Ingyenes üzenetek számlálója
    
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);