const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    date: { type: Date, default: Date.now },
    
    // LICENC ÉS PÉNZÜGYI ADATOK
    hasLicense: { type: Boolean, default: false }, // Ezt bekapcsoljuk fizetéskor
    licenseType: { type: String, default: 'none' }, // 'Havi', 'Féléves', 'Éves'
    licenseExpires: { type: Date, default: null },  // A lejárat pontos dátuma
    totalSpent: { type: Number, default: 0 },       // Mennyit fizetett összesen
    
    myReferralCode: { type: String, default: '' }
});

module.exports = mongoose.model('User', UserSchema);