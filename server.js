const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');
const axios = require('axios');
const OpenAI = require('openai');

const User = require('./models/User');
const Tip = require('./models/Tip');

const app = express();

// KULCSOK BETÖLTÉSE A RAILWAY-BŐL (ÍGY BIZTONSÁGOS!)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SPORT_API_KEY = process.env.SPORT_API_KEY;

if (!OPENAI_API_KEY || !SPORT_API_KEY) {
    console.error("HIBA: A kulcsok nincsenek beállítva a Railway Variables menüben!");
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ADATBÁZIS
const dbURI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/skyhigh';
mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB OK'))
    .catch(err => console.log('❌ DB Hiba:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET || 'titkos_kod',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURI }),
    cookie: { maxAge: 86400000 }
}));

// ALAP ÚTVONALAK
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render('login'));
app.get('/regisztracio', (req, res) => res.render('register'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// AUTH
app.post('/auth/register', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.password, 10);
        await new User({ fullname: req.body.fullname, email: req.body.email, password: hashed }).save();
        res.redirect('/login');
    } catch { res.send('Hiba történt.'); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user && await bcrypt.compare(req.body.password, user.password)){
        req.session.userId = user._id;
        req.session.isAdmin = (req.body.email === 'stylefaqu@gmail.com');
        res.redirect('/dashboard');
    } else { res.send('Hibás adatok'); }
});

// DASHBOARD
const requireLogin = (req, res, next) => req.session.userId ? next() : res.redirect('/login');
app.get('/dashboard', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const todayTip = await Tip.findOne().sort({ createdAt: -1 });
    res.render('dashboard', { user, isAdmin: req.session.isAdmin, dailyTip: todayTip });
});

// FIZETÉS
app.get('/fizetes', requireLogin, (req, res) => res.render('pay'));
app.post('/pay/create-checkout-session', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    user.hasLicense = true; 
    user.licenseExpires = new Date(Date.now() + 30*24*60*60*1000); // 30 nap
    await user.save();
    res.render('pay_success', { plan: 'Havi', date: user.licenseExpires.toLocaleDateString() });
});

// CHAT API
app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const systemPrompt = user.hasLicense 
            ? "Te egy profi sportfogadó asszisztens vagy. Segíts a tőkekezelésben."
            : "Te egy értékesítő vagy. Győzd meg a felhasználót, hogy vegye meg a 20.000 Ft-os licencet.";

        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: req.body.message }],
            model: "gpt-3.5-turbo",
        });
        res.json({ reply: completion.choices[0].message.content });
    } catch (error) { res.status(500).json({ reply: "Hiba az AI kapcsolatban." }); }
});

// GENERÁTOR
const requireAdmin = (req, res, next) => req.session.isAdmin ? next() : res.redirect('/dashboard');
app.get('/admin/generate-tip', requireLogin, requireAdmin, async (req, res) => {
    try {
        // 1. Sport Adatok
        const options = {
            method: 'GET',
            url: 'https://v3.football.api-sports.io/fixtures',
            params: { date: new Date().toISOString().split('T')[0], league: '39', season: '2023' },
            headers: { 'x-apisports-key': SPORT_API_KEY }
        };
        let matches = (await axios.request(options)).data.response;
        if(!matches || matches.length < 2) matches = []; // Hiba kezelés, ha üres

        const matchNames = matches.slice(0, 5).map(m => `${m.teams.home.name} vs ${m.teams.away.name}`).join(', ');

        // 2. AI Elemzés
        const prompt = `Válassz 2 meccset ebből: ${matchNames}. JSON formátum: { "prediction": "...", "odds": "...", "reasoning": "..." }`;
        const gpt = await openai.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "gpt-3.5-turbo"
        });

        let content = gpt.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
        const result = JSON.parse(content);

        await new Tip({
            date: new Date().toLocaleDateString(),
            match: "NAPI FIX (AI)",
            prediction: result.prediction || "Tipp generálva",
            odds: result.odds || "2.00",
            reasoning: result.reasoning || "Elemzés kész."
        }).save();

        res.redirect('/dashboard');
    } catch (e) {
        console.error(e);
        res.send("Hiba: " + e.message);
    }
});

// ADMIN
app.get('/admin', requireLogin, requireAdmin, async (req, res) => {
    const users = await User.find();
    res.render('admin', { users });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server fut: ${PORT}`));