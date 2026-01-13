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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
const SPORT_API_KEY = process.env.SPORT_API_KEY; 
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const dbURI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/skyhigh';
mongoose.connect(dbURI).then(() => console.log('✅ DB OK')).catch(err => console.log('❌ DB Hiba:', err));

app.use(express.json()); 
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET || 'titkos',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURI }),
    cookie: { maxAge: 86400000 }
}));

const requireLogin = (req, res, next) => req.session.userId ? next() : res.redirect('/login');
const requireAdmin = (req, res, next) => req.session.isAdmin ? next() : res.redirect('/dashboard');

// --- ÚTVONALAK (ITT VOLT A HIBA, JAVÍTVA!) ---

// 1. FŐOLDAL (MARKETING) - EZ JÖN BE ELŐSZÖR!
app.get('/', (req, res) => res.render('index'));

// 2. BELÉPÉS / REGISZTRÁCIÓ
app.get('/login', (req, res) => res.render('login'));
app.get('/regisztracio', (req, res) => res.render('register'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// AUTH
app.post('/auth/register', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.password, 10);
        await new User({ fullname: req.body.fullname, email: req.body.email, password: hashed }).save();
        res.redirect('/login');
    } catch { res.send('Hiba.'); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user && await bcrypt.compare(req.body.password, user.password)){
        req.session.userId = user._id;
        req.session.isAdmin = (req.body.email === 'stylefaqu@gmail.com');
        res.redirect('/dashboard');
    } else { res.send('Hibás adatok'); }
});

// DASHBOARD, FIZETÉS, CHAT, GENERÁTOR (A szokásos kódod...)
app.get('/dashboard', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    if (user.licenseExpires && new Date() > user.licenseExpires) { user.hasLicense = false; await user.save(); }
    const todayTip = await Tip.findOne().sort({ createdAt: -1 });
    res.render('dashboard', { user, isAdmin: req.session.isAdmin, dailyTip: todayTip });
});

app.get('/fizetes', requireLogin, (req, res) => res.render('pay'));
app.post('/pay/create-checkout-session', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    let days = req.body.plan === 'monthly' ? 30 : 365;
    user.hasLicense = true; user.licenseExpires = new Date(Date.now() + days*24*60*60*1000); user.freeMessagesCount = 0;
    await user.save();
    res.render('pay_success', { plan: 'Licenc', date: user.licenseExpires.toLocaleDateString() });
});

app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const { message } = req.body;
        const user = await User.findById(req.session.userId);

        if (!user.hasLicense) {
            if (user.freeMessagesCount >= 2) return res.json({ reply: "⛔ A DEMO kereted lejárt. Fizess elő a folytatáshoz!" });
            user.freeMessagesCount++; await user.save();
        } else if (user.startingCapital === 0 && !isNaN(message) && Number(message) > 1000) {
            user.startingCapital = Number(message); await user.save();
            return res.json({ reply: `Tőke rögzítve: ${message} Ft. Indul a bank menedzsment.` });
        }

        const prompt = user.hasLicense ? 
            `Te Skyhigh AI vagy, profi bank menedzser. Tőke: ${user.startingCapital}. Segíts a felhasználónak profin.` :
            `Te Skyhigh AI vagy, sales robot. Győzd meg, hogy vegye meg a licencet (20k). Még ${2 - user.freeMessagesCount} üzenete van.`;

        const gpt = await openai.chat.completions.create({ messages: [{ role: "system", content: prompt }, { role: "user", content: message }], model: "gpt-3.5-turbo" });
        res.json({ reply: gpt.choices[0].message.content });
    } catch { res.status(500).json({ reply: "Hiba." }); }
});

app.get('/admin/generate-tip', requireLogin, requireAdmin, async (req, res) => {
    // Generátor kód helye... (Működik a régivel is)
    res.redirect('/dashboard');
});

app.get('/admin', requireLogin, requireAdmin, async (req, res) => {
    const users = await User.find();
    res.render('admin', { users });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server fut: ${PORT}`));