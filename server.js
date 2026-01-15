const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const app = express();

// FŐNÖK ADATAI (Ezt cseréld, ha másik email kell)
const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const BRAND_NAME = "Zsivány Róka"; 

// --- ADATBÁZIS MODELLEK ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 },
    currentBankroll: { type: Number, default: 0 },
    monthlyProfit: { type: Number, default: 0 } // Havi tiszta haszon
}));

const Tip = mongoose.models.Tip || mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String, matchTime: String, 
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }, isReal: { type: Boolean, default: false }
}));

const SystemSetting = mongoose.models.SystemSetting || mongoose.model('SystemSetting', new mongoose.Schema({
    strategyMode: { type: String, default: 'normal' } 
}));

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

// --- BEÁLLÍTÁSOK ---
const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 Róka Motor v34 - ONLINE`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- ADMIN ELLENŐRZŐ (Middleware) ---
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const u = await User.findById(req.session.userId);
    // Ha admin VAGY a Főnök emailje:
    if (u && (u.isAdmin || u.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- ÚTVONALAK ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'fox_v34_secure', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 órás belépés
}));

// 1. DASHBOARD
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    
    // Bankár logika
    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const bank = user.currentBankroll || user.startingCapital || 0;
    
    res.render('dashboard', { 
        user, dailyTip, suggestedStake: Math.round(bank * p), userBank: bank, strategyMode: settings.strategyMode,
        monthlyProfit: user.monthlyProfit || 0
    });
});

// 2. STATISZTIKA (EZ HIÁNYZOTT!)
app.get('/stats', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    
    // Havi statisztika lekérése
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const tips = await Tip.find({ date: { $gte: startOfMonth }, status: { $ne: 'pending' } }).sort({ date: -1 });
    
    let wins = tips.filter(t => t.status === 'win').length;
    let losses = tips.filter(t => t.status === 'loss').length;
    
    res.render('stats', { user, tips, wins, losses, monthlyProfit: user.monthlyProfit || 0 });
});

// 3. ADMIN HQ
app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(20);
    
    res.render('admin', { users, currentTip, chatHistory, strategyMode: settings.strategyMode, brandName: BRAND_NAME });
});

// --- FUNKCIÓK ---

// Beállítások mentése
app.post('/admin/update-settings', checkAdmin, async (req, res) => {
    await SystemSetting.findOneAndUpdate({}, { strategyMode: req.body.mode }, { upsert: true });
    res.redirect('/admin');
});

// Szöveg finomító AI
app.post('/admin/refine-text', checkAdmin, async (req, res) => {
    const tip = await Tip.findOne({ date: getDbDate() });
    if (!tip) return res.redirect('/admin');
    const refined = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{ role: "system", content: "Legyél rövidebb, dörzsöltebb!" }, { role: "user", content: tip.memberMessage }]
    });
    await Tip.findByIdAndUpdate(tip._id, { memberMessage: refined.choices[0].message.content });
    res.redirect('/admin');
});

// EREDMÉNY ELSZÁMOLÁSA (BANK + PROFIT)
app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const tip = await Tip.findOne({ date: getDbDate() });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    if (!tip || tip.status !== 'pending') return res.redirect('/admin');

    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const users = await User.find({ isAdmin: false });
    
    for (let u of users) {
        let b = u.currentBankroll || u.startingCapital || 0;
        // Ha valakinek 0 a bankja, nem tudunk számolni, átugorjuk vagy 0 marad
        if (b > 0) {
            let s = b * p; // Tét
            let profit = 0;

            if (req.body.status === 'win') {
                profit = s * (parseFloat(tip.odds) - 1);
                b += profit;
            } else {
                profit = -s;
                b -= s;
            }

            u.currentBankroll = Math.round(b);
            u.monthlyProfit = (u.monthlyProfit || 0) + Math.round(profit);
            await u.save();
        }
    }
    tip.status = req.body.status;
    await tip.save();
    res.redirect('/admin');
});

// Havi Nullázó
app.post('/admin/reset-monthly', checkAdmin, async (req, res) => {
    await User.updateMany({}, { monthlyProfit: 0 });
    res.redirect('/admin');
});

// Robot futtatás
app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();
    try {
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        const matches = response.data.matches || [];
        let fixtures = matches.filter(m => m.status === 'TIMED');
        
        // Ha nincs meccs, vagy hiba van, akkor is generálunk egy "PLACEHOLDER" tippet teszteléshez ha kell
        // De most az éles logika:
        if (fixtures.length === 0) return res.redirect('/admin');

        const matchData = fixtures.slice(0, 10).map(m => `${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`).join("\n");
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Te vagy a Zsivány Róka. Válassz egy tutit. JSON formátum: { \"league\":\"\", \"match\":\"\", \"prediction\":\"\", \"odds\":\"\", \"reasoning\":\"\", \"matchTime\":\"HH:mm\" }" }, { role: "user", content: matchData }],
            response_format: { type: "json_object" }
        });
        const result = JSON.parse(aiRes.choices[0].message.content);
        const marketingRes = await openai.chat.completions.create({
             model: "gpt-4-turbo-preview",
             messages: [{ role: "system", content: "Rövid, dörzsölt, motiváló üzenet a tagoknak." }, { role: "user", content: `Meccs: ${result.match}, Tipp: ${result.prediction}` }] 
        });

        await Tip.findOneAndUpdate({ date: targetDate }, { 
            ...result, memberMessage: marketingRes.choices[0].message.content,
            date: targetDate, is