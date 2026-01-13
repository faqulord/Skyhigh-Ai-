const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const path = require('path');
const app = express();

// --- KONFIGURÁCIÓ ---
const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SPORT_API_KEY = process.env.SPORT_API_KEY; 

mongoose.connect(process.env.MONGO_URL).then(() => console.log("🚀 DB Connected"));

// --- ADATMODELLEK ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String,
    email: { type: String, unique: true, lowercase: true },
    password: String,
    hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    startingCapital: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, prediction: String, odds: Number, reasoning: String,
    profitPercent: { type: Number, default: 0 },
    date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}));

// --- MIDDLEWARES ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'skyhigh_neural_quantum_key_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// --- ROBOT LOGIKA (API-FOOTBALL + OPENAI) ---
async function runAiRobot() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${today}`, {
            headers: { 'x-apisports-key': SPORT_API_KEY }
        });
        const matches = response.data.response.slice(0, 15).map(m => `${m.teams.home.name} vs ${m.teams.away.name}`).join(", ");
        
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "system", content: "Profi fogadó AI vagy. Adj Master Tippet JSON-ban: {match, prediction, odds, reasoning, profitPercent}" }],
            response_format: { type: "json_object" }
        });
        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: today }, result, { upsert: true });
        console.log("✅ Robot elemzés kész.");
    } catch (e) { console.log("Robot hiba:", e.message); }
}

// --- ÚTVONALAK ---

// Kezdőlap, Login, Register
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// Dashboard (Licenc és tőke ellenőrzéssel)
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);

    // Tulajdonos automatikus admin
    if (user.email === OWNER_EMAIL && !user.isAdmin) {
        user.isAdmin = true;
        user.hasLicense = true;
        await user.save();
    }

    if (!user.hasLicense && !user.isAdmin) return res.render('pricing');
    if (user.hasLicense && user.startingCapital === 0) return res.render('pricing'); // Kérje be a tőkét!

    const today = new Date().toISOString().split('T')[0];
    const dailyTip = await Tip.findOne({ date: today });
    const history = await Tip.find().sort({ date: -1 }).limit(30);

    res.render('dashboard', { user, dailyTip, history });
});

// Tőke mentése
app.post('/user/set-capital', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    await User.findByIdAndUpdate(req.session.userId, { 
        startingCapital: req.body.capital, 
        hasLicense: true 
    });
    res.redirect('/dashboard');
});

// AUTH
app.post('/auth/register', async (req, res) => {
    const hashed = await bcrypt.hash(req.body.password, 10);
    await new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashed }).save();
    res.redirect('/login');
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else res.send("Hiba!");
});

// ADMIN
app.get('/admin', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user.isAdmin) return res.redirect('/dashboard');
    const users = await User.find();
    const tips = await Tip.find().sort({ date: -1 });
    res.render('admin', { user, users, tips });
});

app.post('/admin/run-robot', async (req, res) => {
    await runAiRobot();
    res.redirect('/admin');
});

app.listen(process.env.PORT || 8080);