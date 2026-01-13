const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios');
const { OpenAI } = require('openai');
const path = require('path');
const app = express();

// --- KONFIGURÁCIÓ ---
const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SPORT_API_KEY = process.env.SPORT_API_KEY; 
const MONGO_CONNECTION = process.env.MONGO_URL;

mongoose.connect(MONGO_CONNECTION).then(() => console.log("🚀 DB Connected"));

// --- MODELLEK ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, prediction: String, odds: String, reasoning: String,
    date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}));

// --- SZERVEZÉS ÉS RENDERELÉS ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_ultra_safe_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_CONNECTION }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// --- ÚTVONALAK ---

app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));

app.get('/dashboard', async (req, res) => {
    try {
        if (!req.session.userId) return res.redirect('/login');
        const user = await User.findById(req.session.userId);

        // Automatikus Tulajdonos jogok
        if (user.email === OWNER_EMAIL && !user.isAdmin) {
            user.isAdmin = true;
            user.hasLicense = true;
            await user.save();
        }

        if (!user.hasLicense && !user.isAdmin) return res.render('pricing');

        const today = new Date().toISOString().split('T')[0];
        const dailyTip = await Tip.findOne({ date: today });
        const history = await Tip.find().sort({ date: -1 }).limit(30);

        res.render('dashboard', { user, dailyTip, history });
    } catch (err) {
        res.status(500).send("Hiba a Dashboard betöltésekor: " + err.message);
    }
});

// Admin Panel és Robot indítás
app.get('/admin', async (req, res) => {
    const user = await User.findById(req.session.userId);
    if (!user || !user.isAdmin) return res.redirect('/dashboard');
    const users = await User.find().sort({ createdAt: -1 });
    res.render('admin', { user, users });
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else res.send("Hibás belépés!");
});

app.post('/auth/register', async (req, res) => {
    const hashed = await bcrypt.hash(req.body.password, 10);
    await new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashed }).save();
    res.redirect('/login');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Skyhigh Online: ${PORT}`));