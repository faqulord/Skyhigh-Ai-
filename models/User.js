const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    date: { type: Date, default: Date.now },
    
    // LICENC ADATOK
    licenseType: { type: String, default: 'none' }, // 'monthly', 'biannual', 'annual'
    licenseExpires: { type: Date, default: null }, // Mikor jár le?
    
    // PÉNZÜGYI ADATOK
    totalSpent: { type: Number, default: 0 }, // Mennyit költött nálad eddig
    stripeCustomerId: { type: String }
});

// Automatikus ellenőrzés: Van érvényes licence?
UserSchema.virtual('hasLicense').get(function() {
    if (!this.licenseExpires) return false;
    return this.licenseExpires > new Date(); // Ha a lejárat dátuma a jövőben van, akkor aktív
});

module.exports = mongoose.model('User', UserSchema);