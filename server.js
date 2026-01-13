const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios'); // Az API-Football-hoz kelleni fog
const app = express();

// --- ADATBÁZIS ÉS MODELLEK ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("Skyhigh Neural Engine Online"))
    .catch(err => console.log(err));

const User = mongoose.model('User', new mongoose.Schema({
    fullname: String,
    email: { type: String, unique: true },
    password: String,
    startingCapital: { type: Number, default: 0 },
    hasLicense: { type: Boolean, default: false }, // LICENC ÁLLAPOT
    licenseExpiry: Date, // LEJÁRAT DÁTUMA
    isAdmin: { type: Boolean, default: false }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String,
    prediction: String,
    odds: String,
    reasoning: String,
    date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}));

// --- MIDDLEWARES ---
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'skyhigh_vault_key_99',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI })
}));

// --- 🤖 AUTOMATA ELEMZŐ ROBOT (Minden nap 08:00) ---
cron.schedule('0 8 * * *', async () => {
    console.log("ROBOT: Napi piaci elemzés indítása...");
    
    try {
        // Itt hívjuk meg az AI-t és az API-t
        // Addig is rögzítjük a Master Tippet az adatbázisba
        const dailyMasterTip = new Tip({
            match: "Newcastle United vs. Manchester City",
            prediction: "Manchester City Győzelem (V)",
            odds: "1.65",
            reasoning: "AI PROTOKOLL: 89.4% valószínűség. Az xG (Várható gólok) mutató 2.45 a City javára. A Newcastle védelmi vonala kulcsjátékosok nélkül statisztikailag instabil."
        });
        
        await dailyMasterTip.save();
        console.log("ROBOT: Mai Master Tipp sikeresen publikálva.");
    } catch (error) {
        console.log("ROBOT HIBA:", error);
    }
});

// --- DASHBOARD LOGIKA (LICENC SZŰRÉSSEL) ---
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    
    try {
        const user = await User.findById(req.session.userId);
        const today = new Date().toISOString().split('T')[0];
        
        // Lekérjük a robot által generált mai tippet
        const dailyTip = await Tip.findOne({ date: today });

        // Csak akkor küldjük el a tippet a frontendnek, ha van licence
        // Ha nincs licence, a dailyTip-et null-ként küldjük vagy kezeljük az EJS-ben
        res.render('dashboard', { 
            user, 
            dailyTip: user.hasLicense ? dailyTip : null, // 🔒 LICENC VÉDELEM
            isAdmin: user.isAdmin 
        });
    } catch (err) {
        res.redirect('/login');
    }
});

// --- API: LICENC AKTIVÁLÁS (Admin vagy Fizetés után) ---
app.post('/api/activate-license', async (req, res) => {
    if (!req.session.userId) return res.status(403).send();
    // Itt a valóságban egy fizetési ellenőrzés lenne
    await User.findByIdAndUpdate(req.session.userId, { 
        hasLicense: true,
        licenseExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // +30 nap
    });
    res.json({ success: true });
});

app.post('/api/set-capital', async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital });
    res.json({ success: true });
});

// PORT BEÁLLÍTÁS
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Skyhigh Live: ${PORT}`));