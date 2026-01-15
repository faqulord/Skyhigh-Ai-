const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const app = express();

const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const BRAND_NAME = "Zsivány Róka"; 

// --- RÓKA ARANYKÖPÉSEK (Dashboardra) ---
const FOX_QUOTES = [
    "A buki már sírva ébredt ma reggel... 🦊",
    "A tőke a fegyvered, a türelem a pajzsod!",
    "Ma fosztogatunk, nem kérdezünk. 💰",
    "Hideg fej, forró oddsok, tele zseb.",
    "Ne tippelj. Vadássz! 🎯"
];

// --- MODELLEK (Bankár Logikával Bővítve) ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 },
    currentBankroll: { type: Number, default: 0 }, // Bankár logika: Aktuális vagyon
    monthlyProfit: { type: Number, default: 0 }    // Bankár logika: Havi profit
}));

const Tip = mongoose.models.Tip || mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String, matchTime: String, 
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }, isReal: { type: Boolean, default: false }
}));

// Stratégia beállítások (Ez hiányzott a régiből!)
const SystemSetting = mongoose.models.SystemSetting || mongoose.model('SystemSetting', new mongoose.Schema({
    strategyMode: { type: String, default: 'normal' } 
}));

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 RÓKA BANKÁR V40 - ONLINE`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- MIDDLEWARE ---
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const u = await User.findById(req.session.userId);
    if (u && (u.isAdmin || u.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'fox_v40_banker', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// ==================================================
// 🦊 1. ROBOT FUTTATÁS (OKOS PROMPTTAL)
// ==================================================
app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();
    try {
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        const matches = response.data.matches || [];
        
        // Csak a releváns meccsek
        let fixtures = matches.filter(m => m.status === 'TIMED' || m.status === 'SCHEDULED');
        if (fixtures.length === 0) return res.redirect('/admin');

        const matchData = fixtures.slice(0, 20).map(m => `${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`).join("\n");
        
        // BIZTONSÁGOS AI PROMPT
        const systemPrompt = `Te vagy a Zsivány Róka. Keress a listából 70%+ valószínűségű, biztonságos tippet. JSON: { "league":"", "match":"", "prediction":"", "odds":"", "reasoning":"", "matchTime":"HH:mm" }`;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: matchData }],
            response_format: { type: "json_object" }
        });
        
        const result = JSON.parse(aiRes.choices[0].message.content);
        
        // MARKETING SZÖVEG
        const marketingRes = await openai.chat.completions.create({
             model: "gpt-4-turbo-preview",
             messages: [{ role: "system", content: "Írj egy rövid, dörzsölt, de nem agresszív üzenetet a tagoknak ehhez a tipphez." }, { role: "user", content: `Tipp: ${result.prediction}` }] 
        });

        await Tip.findOneAndUpdate({ date: targetDate }, { 
            ...result, 
            memberMessage: marketingRes.choices[0].message.content,
            date: targetDate, isPublished: false, isReal: true, status: 'pending'
        }, { upsert: true });

    } catch (e) { console.error("AI Error:", e); }
    res.redirect('/admin');
});

// ==================================================
// 💰 2. BANKÁR LOGIKA (EZT HIÁNYOLTAD!)
// ==================================================

// Eredmény elszámolása (WIN/LOSS) -> Pénz jóváírása
app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const tip = await Tip.findOne({ date: getDbDate() });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    
    if (!tip || tip.status !== 'pending') return res.redirect('/admin');

    // Stratégia szerinti kockázat (1.5%, 3%, 6%)
    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    
    const users = await User.find({ isAdmin: false });
    
    for (let u of users) {
        // Ha még nincs currentBankroll beállítva, használjuk a startingCapitalt
        let b = u.currentBankroll || u.startingCapital || 0;
        
        if (b > 0) {
            let stake = Math.round(b * p); // A tét összege
            let profit = 0;

            if (req.body.status === 'win') {
                // Nyeremény: Tét * (Odds - 1)
                profit = Math.round(stake * (parseFloat(tip.odds) - 1));
                b += profit;
            } else {
                // Veszteség: Tét levonása
                profit = -stake;
                b -= stake;
            }

            u.currentBankroll = b;
            u.monthlyProfit = (u.monthlyProfit || 0) + profit;
            await u.save();
        }
    }

    tip.status = req.body.status;
    await tip.save();
    res.redirect('/admin');
});

// Havi nullázó
app.post('/admin/reset-monthly', checkAdmin, async (req, res) => {
    await User.updateMany({}, { monthlyProfit: 0 });
    res.redirect('/admin');
});

// Stratégia váltó
app.post('/admin/update-settings', checkAdmin, async (req, res) => {
    await SystemSetting.findOneAndUpdate({}, { strategyMode: req.body.mode }, { upsert: true });
    res.redirect('/admin');
});

// ==================================================
// 🖥️ 3. ADMIN OLDAL (ADATOKKAL)
// ==================================================
app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(20);
    
    res.render('admin', { 
        users, 
        currentTip, 
        chatHistory, 
        strategyMode: settings.strategyMode, // Fontos: átadjuk a stratégiát
        brandName: BRAND_NAME 
    });
});

// Licensz gomb
app.post('/admin/toggle-license', checkAdmin, async (req, res) => {
    const u = await User.findById(req.body.userId);
    if(u) { u.hasLicense = !u.hasLicense; await u.save(); }
    res.redirect('/admin');
});

// Publikálás
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { 
    await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); 
    res.redirect('/admin'); 
});

// Marketing Generáló (Biztonságos verzió)
app.post('/admin/social-content', checkAdmin, async (req, res) => {
    const prompt = req.body.type === 'win' 
        ? "Te vagy a Zsivány Róka. Írj egy magabiztos Insta posztot a mai nyereményről! Emojik: 🦊💰." 
        : "Te vagy a Zsivány Róka. Írj egy motivációs posztot a fegyelemről.";
    try {
        const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "user", content: prompt }] });
        res.json({ content: aiRes.choices[0].message.content });
    } catch(e) { res.json({ content: "Hiba az AI-nál." }); }
});

// Chat
app.post('/admin/chat', checkAdmin, async (req, res) => {
    try {
        const { message } = req.body;
        await new ChatMessage({ sender: 'Főnök', text: message }).save();
        const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Rövid válasz." }, { role: "user", content: message }] });
        await new ChatMessage({ sender: 'Róka', text: aiRes.choices[0].message.content }).save();
        res.json({ reply: aiRes.choices[0].message.content });
    } catch(e) { res.json({ reply: "Hiba." }); }
});

// ==================================================
// 📱 4. DASHBOARD (BANKÁR ADATOKKAL)
// ==================================================
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    
    // Itt számoljuk a tétet!
    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const bank = user.currentBankroll || user.startingCapital || 0;
    const recommendedStake = Math.round(bank * p);

    res.render('dashboard', { 
        user, 
        dailyTip, 
        suggestedStake: recommendedStake, // Kiszámolt tét
        userBank: bank,                   // Aktuális vagyon
        strategyMode: settings.strategyMode, 
        monthlyProfit: user.monthlyProfit || 0,
        foxQuotes: FOX_QUOTES 
    });
});

app.post('/user/update-bank', async (req, res) => {
    const amount = parseInt(req.body.amount);
    if (!isNaN(amount)) await User.findByIdAndUpdate(req.session.userId, { startingCapital: amount, currentBankroll: amount });
    res.redirect('/dashboard');
});

// ==================================================
// 🔐 AUTH & EGYÉB
// ==================================================
app.post('/auth/login', async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase() });
    if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); }
    else res.send("Hiba: Rossz jelszó vagy email.");
});
app.get('/login', (req, res) => res.render('login'));
app.get('/', (req, res) => res.render('index'));
app.get('/logout', (req, res) => { req.session.destroy(() => { res.redirect('/'); }); });
app.get('/stats', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const tips = await Tip.find({ date: { $gte: startOfMonth }, status: { $ne: 'pending' } }).sort({ date: -1 });
    let wins = tips.filter(t => t.status === 'win').length;
    let losses = tips.filter(t => t.status === 'loss').length;
    res.render('stats', { user, tips, wins, losses, monthlyProfit: user.monthlyProfit || 0 });
});

app.listen(process.env.PORT || 8080);