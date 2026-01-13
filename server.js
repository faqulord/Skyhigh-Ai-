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

mongoose.connect(MONGO_CONNECTION).then(() => console.log("🚀 Neural Engine Online"));

// --- ADATMODELLEK ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String,
    email: { type: String, unique: true, lowercase: true },
    password: String,
    hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String,
    prediction: String,
    odds: String,
    reasoning: String,
    date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}));

// --- SZERVER BEÁLLÍTÁSOK ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_production_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_CONNECTION }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// --- 🤖 PROFI AI ROBOT FUNKCIÓ ---
async function runMasterAnalysis() {
    try {
        const today = new Date().toISOString().split('T')[0];
        console.log("⚽ Adatgyűjtés és AI elemzés folyamatban...");

        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${today}`, {
            headers: { 'x-apisports-key': SPORT_API_KEY }
        });

        const fixtures = response.data.response.slice(0, 15);
        if (fixtures.length === 0) return console.log("Nincs mai meccs.");

        const matchData = fixtures.map(f => `${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`).join(", ");

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: "Profi sportfogadási matematikus vagy. Válaszd ki a nap Master Tippjét. Válasz JSON: {match, prediction, odds, reasoning}" },
                { role: "user", content: `Mai kínálat: ${matchData}` }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: today }, result, { upsert: true });
        console.log("✅ Mai Master Tipp elmentve.");
    } catch (e) {
        console.error("AI Hiba:", e.message);
    }
}

// Ütemezés: Minden reggel 08:00
cron.schedule('0 8 * * *', runMasterAnalysis);

// --- ÚTVONALAK (LOGIKA) ---

app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// DASHBOARD - Itt látható a tipp
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    
    const user = await User.findById(req.session.userId);
    
    // Automatikus Tulajdonos jog (stylefaqu@gmail.com)
    if (user.email === OWNER_EMAIL && !user.isAdmin) {
        user.isAdmin = true;
        user.hasLicense = true;
        await user.save();
    }

    // Licenc ellenőrzés (ha nem tulajdonos és nincs licence)
    if (!user.hasLicense && !user.isAdmin) return res.render('pricing');

    const today = new Date().toISOString().split('T')[0];
    const dailyTip = await Tip.findOne({ date: today });
    const history = await Tip.find().sort({ date: -1 }).limit(7);

    res.render('dashboard', { user, dailyTip, history });
});

// LOGIN MŰVELET
app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body