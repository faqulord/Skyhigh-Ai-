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

// --- TULAJDONOSI KONFIGURÁCIÓ ---
const OWNER_EMAIL = "stylefaqu@gmail.com"; 

// --- API ÉS DB KAPCSOLAT ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SPORT_API_KEY = process.env.SPORT_API_KEY; 
const MONGO_CONNECTION = process.env.MONGO_URL;

mongoose.connect(MONGO_CONNECTION)
    .then(() => console.log("🚀 Skyhigh Neural Engine Online"))
    .catch(err => console.error("❌ DB Hiba:", err));

// --- ADATMODELL ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String,
    email: { type: String, unique: true, lowercase: true },
    password: String,
    hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, prediction: String, odds: String, reasoning: String,
    date: { type: String, default: () => new Date().toISOString().split('T')[0] },
    timestamp: { type: Date, default: Date.now }
}));

// --- SZERVER BEÁLLÍTÁSOK ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// HTML kényszerítés a fehér képernyő ellen
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    next();
});

app.use(session({
    secret: 'skyhigh_final_safe_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_CONNECTION }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// --- 🤖 AI ROBOT (Minden reggel 08:00) ---
async function runMasterAnalysis() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${today}`, {
            headers: { 'x-apisports-key': SPORT_API_KEY }
        });
        const fixtures = response.data.response.slice(0, 20);
        if (fixtures.length === 0) return;

        const matchSummary = fixtures.map(f => `${f.teams.home.name} vs ${f.teams.away.name}`).join(", ");
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "system", content: "Profi fogadó AI vagy. Adj Master Tippet JSON-ban: {match, prediction, odds, reasoning}" },
                       { role: "user", content: `Elemezd: ${matchSummary}` }],
            response_format: { type: "json_object" }
        });
        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: today }, result, { upsert: true });
        console.log("✅ Robot elemzés kész.");
    } catch (e) { console.error("Robot hiba:", e.message); }
}
cron.schedule('0 8 * * *', runMasterAnalysis);

// --- ÚTVONALAK ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('index');
});

app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);

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
});

app.get('/admin', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user.isAdmin) return res.redirect('/dashboard');
    const users = await User.find().sort({ createdAt: -1 });
    res.render('admin', { user, users });
});

app.post('/admin/force-ai', async (req, res) => {
    await runMasterAnalysis();
    res.redirect('/admin');
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else {
        res.send("Hibás belépés!");
    }
});

app.post('/auth/register', async (req, res) => {
    const hashed = await bcrypt.hash(req.body.password, 10);
    await new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashed }).save();
    res.redirect('/login');
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Skyhigh Online: ${PORT}`));