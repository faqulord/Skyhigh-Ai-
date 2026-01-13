const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const app = express();

// --- KONFIGURÁCIÓ (PONTOSAN A TE RAILWAY VÁLTOZÓDHOZ IGAZÍTVA) ---
const MONGO_CONNECTION = process.env.MONGO_URL; // Frissítve MONGO_URL-re!

// --- ADATBÁZIS CSATLAKOZÁS ---
if (!MONGO_CONNECTION) {
    console.error("❌ HIBA: A MONGO_URL változó nem található a Railway-en!");
}

mongoose.connect(MONGO_CONNECTION)
.then(() => console.log("✅ Skyhigh DB Csatlakoztatva (MONGO_URL)"))
.catch(err => console.error("❌ DB Hiba:", err));

// --- MODELLEK ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, 
    email: { type: String, unique: true, required: true }, 
    password: { type: String, required: true },
    startingCapital: { type: Number, default: 0 }, 
    hasLicense: { type: Boolean, default: true },
    isAdmin: { type: Boolean, default: false }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, prediction: String, odds: String, reasoning: String,
    date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}));

// --- MIDDLEWARES ---
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'skyhigh_quantum_safe_key_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: MONGO_CONNECTION // Most már ez is látja az adatbázist!
    }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// --- 🤖 AUTOMATA ROBOT (Napi Master Tipp) ---
cron.schedule('0 8 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
    const existing = await Tip.findOne({ date: today });
    if (!existing) {
        await new Tip({
            match: "Newcastle vs. Manchester City",
            prediction: "Manchester City Győzelem",
            odds: "1.65",
            reasoning: "AI PROTOKOLL: 89.4% valószínűség. Az xG mutató 2.45 a City javára. A Newcastle védelme kulcsjátékosok nélkül statisztikailag instabil."
        }).save();
    }
});

// --- ÚTVONALAK ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/regisztracio', (req, res) => res.render('register'));

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId);
        const today = new Date().toISOString().split('T')[0];
        let dailyTip = await Tip.findOne({ date: today });

        if (!dailyTip) {
            dailyTip = { 
                match: "Newcastle vs. Man. City", prediction: "Man. City", odds: "1.65", 
                reasoning: "A Skyhigh Core AI elemzése alapján a City dominanciája várható." 
            };
        }
        res.render('dashboard', { user, dailyTip, isAdmin: user.isAdmin });
    } catch (err) { res.redirect('/login'); }
});

// --- AUTH LOGIKA ---
app.post('/auth/register', async (req, res) => {
    try {
        const { fullname, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        await new User({ fullname, email: email.toLowerCase(), password: hashedPassword }).save();
        res.redirect('/login');
    } catch (err) { res.send("Hiba a regisztrációnál!"); }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            req.session.save(() => res.redirect('/dashboard'));
        } else {
            res.send("Hibás email vagy jelszó!");
        }
    } catch (err) { res.redirect('/login'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

app.post('/api/set-capital', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({success: false});
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital });
    res.json({ success: true });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Skyhigh Live: ${PORT}`));