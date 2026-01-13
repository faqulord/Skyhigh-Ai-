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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SPORT_API_KEY = process.env.SPORT_API_KEY;
const MONGO_CONNECTION = process.env.MONGO_URL;

mongoose.connect(MONGO_CONNECTION).then(() => console.log("🚀 Skyhigh Engine Online"));

// --- ADATMODELL ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true }, password: String,
    hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, prediction: String, odds: String, reasoning: String,
    date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}));

// --- BEÁLLÍTÁSOK ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'skyhigh_top_secret_2026',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_CONNECTION })
}));

// --- 🤖 AI CHAT ÉS ELEMZÉS ---
async function runAiAnalysis() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${today}`, {
            headers: { 'x-apisports-key': SPORT_API_KEY }
        });
        const matches = response.data.response.slice(0, 10).map(m => `${m.teams.home.name} vs ${m.teams.away.name}`).join(", ");
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "system", content: "Profi sportfogadási AI vagy. Adj Master Tippet JSON-ban: {match, prediction, odds, reasoning}" },
                       { role: "user", content: `Mai meccsek: ${matches}` }]
        });
        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: today }, result, { upsert: true });
    } catch (e) { console.log("AI Hiba:", e.message); }
}
cron.schedule('0 8 * * *', runAiAnalysis);

// AI Chat végpont
app.post('/api/chat', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({error: "Bejelentkezés szükséges"});
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{role: "system", content: "Skyhigh AI vagy, egy profi fogadási tanácsadó."}, {role: "user", content: req.body.message}]
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (e) { res.status(500).json({error: e.message}); }
});

// --- MIDDLEWARE: LICENC ELLENŐRZÉS ---
const checkLicense = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user.isAdmin || user.hasLicense) return next();
    res.render('buy-license'); // Ha nincs licenc, ide dobja
};

// --- ÚTVONALAK ---
app.get('/dashboard', checkLicense, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const today = new Date().toISOString().split('T')[0];
    const dailyTip = await Tip.findOne({ date: today });
    res.render('dashboard', { user, dailyTip });
});

app.get('/admin', async (req, res) => {
    const user = await User.findById(req.session.userId);
    if (!user || !user.isAdmin) return res.redirect('/');
    const users = await User.find();
    res.render('admin', { users });
});

// Admin Műveletek
app.post('/admin/run-ai', async (req, res) => { await runAiAnalysis(); res.redirect('/admin'); });
app.post('/admin/give-license/:id', async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { hasLicense: true });
    res.redirect('/admin');
});

// Auth
app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else res.send("Hiba");
});

app.listen(process.env.PORT || 8080, "0.0.0.0");