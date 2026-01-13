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

mongoose.connect(MONGO_CONNECTION).then(() => console.log("🚀 Skyhigh Engine Ready"));

const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true }, password: String,
    startingCapital: { type: Number, default: 0 }, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, prediction: String, odds: String, reasoning: String,
    date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}));

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'skyhigh_admin_secure_2026',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_CONNECTION })
}));

// --- 🤖 AI FÜGGVÉNY (KÜLÖN IS HÍVHATÓ) ---
async function runAiAnalysis() {
    const today = new Date().toISOString().split('T')[0];
    const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${today}&league=39&season=2025`, {
        headers: { 'x-apisports-key': SPORT_API_KEY }
    });
    const match = response.data.response[0]; // Példa: Első PL meccs
    const aiResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{role: "system", content: "Profi fogadó AI vagy. Adj JSON választ: match, prediction, odds, reasoning."}],
        });
    const result = JSON.parse(aiResponse.choices[0].message.content);
    await Tip.findOneAndUpdate({ date: today }, result, { upsert: true });
    return result;
}

cron.schedule('0 8 * * *', runAiAnalysis);

// --- ADMIN ÚTVONALAK ---
app.get('/admin', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user || !user.isAdmin) return res.send("Nincs jogosultságod!");
    const allUsers = await User.find().sort({ createdAt: -1 });
    res.render('admin', { user, allUsers });
});

app.post('/admin/run-ai', async (req, res) => {
    const user = await User.findById(req.session.userId);
    if (user.isAdmin) {
        await runAiAnalysis();
        res.redirect('/admin');
    }
});

app.post('/admin/toggle-license/:id', async (req, res) => {
    const user = await User.findById(req.session.userId);
    if (user.isAdmin) {
        const target = await User.findById(req.params.id);
        target.hasLicense = !target.hasLicense;
        await target.save();
        res.redirect('/admin');
    }
});

// --- DASHBOARD ---
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user.hasLicense && !user.isAdmin) return res.render('buy-license');
    const today = new Date().toISOString().split('T')[0];
    const dailyTip = await Tip.findOne({ date: today });
    res.render('dashboard', { user, dailyTip });
});

// Login, Register... marad a korábbi.
app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else { res.send("Hiba"); }
});

app.listen(process.env.PORT || 8080, "0.0.0.0");