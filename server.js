const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const app = express();

// FŐNÖK ADATAI
const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const BRAND_NAME = "Zsivány Róka"; 

// --- ADATBÁZIS MODELLEK ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 },
    currentBankroll: { type: Number, default: 0 },
    monthlyProfit: { type: Number, default: 0 } 
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
mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 Róka Motor v35 (FIXED) - ONLINE`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- RÓKA ARANYKÖPÉSEK (EZ HIÁNYZOTT!) ---
const FOX_QUOTES = [
    "A türelem profitot szül.",
    "A buki nem a barátod.",
    "Hideg fej, teli zseb.",
    "A statisztika nem hazudik.",
    "Ne játssz, fektess be!",
    "A bankroll a szentírás."
];

// --- ADMIN ELLENŐRZŐ ---
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const u = await User.findById(req.session.userId);
    if (u && (u.isAdmin || u.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- ALAP BEÁLLÍTÁSOK ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'fox_v35_super_secure', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } 
}));

// --- FŐ ÚTVONALAK ---

// 1. DASHBOARD (JAVÍTVA: foxQuotes átadva!)
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    
    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const bank = user.currentBankroll || user.startingCapital || 0;
    
    res.render('dashboard', { 
        user, dailyTip, suggestedStake: Math.round(bank * p), userBank: bank, strategyMode: settings.strategyMode,
        monthlyProfit: user.monthlyProfit || 0,
        foxQuotes: FOX_QUOTES // <--- EZ A KULCS A FEHÉR KÉPERNYŐ ELLEN!
    });
});

// 2. STATISZTIKA
app.get('/stats', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
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

// 4. KIJELENTKEZÉS
app.get('/logout', (req, res) => {
    req.session.destroy(() => { res.redirect('/'); });
});

// --- ADMIN ÉS AI FUNKCIÓK ---

// ROBOT FUTTATÁS (A BANKÁR AGY)
app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();
    try {
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        const matches = response.data.matches || [];
        let fixtures = matches.filter(m => m.status === 'TIMED'); // Csak jövőbeli meccsek

        // Ha nincs meccs, ne omoljon össze, csak térjen vissza
        if (fixtures.length === 0) { console.log("Nincs meccs ma"); return res.redirect('/admin'); }

        const matchData = fixtures.slice(0, 15).map(m => `${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`).join("\n");
        
        // ITT VAN A RÓKA AGYA: BANKÁR STRATÉGIA
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: "Te vagy a Zsivány Róka, egy dörzsölt sportfogadó AI. A feladatod a 'Bankár Stratégia' követése: keress alacsony kockázatú, de biztosnak tűnő kimeneteleket. Ne kockáztass feleslegesen. Válaszd ki a legbiztosabb meccset. JSON formátum: { \"league\":\"\", \"match\":\"\", \"prediction\":\"\", \"odds\":\"kb. odds\", \"reasoning\":\"\", \"matchTime\":\"HH:mm\" }" }, 
                { role: "user", content: `Elemezd ezeket a mai meccseket és válassz EGYET:\n${matchData}` }
            ],
            response_format: { type: "json_object" }
        });
        const result = JSON.parse(aiRes.choices[0].message.content);
        
        // MARKETING SZÖVEG GENERÁLÁS
        const marketingRes = await openai.chat.completions.create({
             model: "gpt-4-turbo-preview",
             messages: [{ role: "system", content: "Írj egy rövid, dörzsölt, motiváló üzenetet a tagoknak a tipphez. Használj emojikat." }, { role: "user", content: `Meccs: ${result.match}, Tipp: ${result.prediction}` }] 
        });

        await Tip.findOneAndUpdate({ date: targetDate }, { 
            ...result, memberMessage: marketingRes.choices[0].message.content,
            date: targetDate, isPublished: false, isReal: true, status: 'pending'
        }, { upsert: true });
    } catch (e) { console.error("AI Hiba:", e); }
    res.redirect('/admin');
});

// EGYÉB ADMIN POSZTOK
app.post('/admin/update-settings', checkAdmin, async (req, res) => {
    await SystemSetting.findOneAndUpdate({}, { strategyMode: req.body.mode }, { upsert: true });
    res.redirect('/admin');
});
app.post('/admin/refine-text', checkAdmin, async (req, res) => {
    const tip = await Tip.findOne({ date: getDbDate() });
    if (!tip) return res.redirect('/admin');
    const refined = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Legyél rövidebb, dörzsöltebb!" }, { role: "user", content: tip.memberMessage }] });
    await Tip.findByIdAndUpdate(tip._id, { memberMessage: refined.choices[0].message.content });
    res.redirect('/admin');
});
app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const tip = await Tip.findOne({ date: getDbDate() });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    if (!tip || tip.status !== 'pending') return res.redirect('/admin');
    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const users = await User.find({ isAdmin: false });
    for (let u of users) {
        let b = u.currentBankroll || u.startingCapital || 0;
        if (b > 0) {
            let s = b * p;
            let profit = 0;
            if (req.body.status === 'win') { profit = s * (parseFloat(tip.odds) - 1); b += profit; } 
            else { profit = -s; b -= s; }
            u.currentBankroll = Math.round(b);
            u.monthlyProfit = (u.monthlyProfit || 0) + Math.round(profit);
            await u.save();
        }
    }
    tip.status = req.body.status;
    await tip.save();
    res.redirect('/admin');
});
app.post('/admin/reset-monthly', checkAdmin, async (req, res) => { await User.updateMany({}, { monthlyProfit: 0 }); res.redirect('/admin'); });
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });
app.post('/admin/chat', checkAdmin, async (req, res) => {
    const { message } = req.body;
    await new ChatMessage({ sender: 'Főnök', text: message }).save();
    const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Rövid, strategikus válasz." }, { role: "user", content: message }] });
    await new ChatMessage({ sender: 'Róka', text: aiRes.choices[0].message.content }).save();
    res.json({ reply: aiRes.choices[0].message.content });
});
app.post('/admin/social-content', checkAdmin, async (req, res) => { const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "user", content: req.body.type === 'win' ? "Insta poszt nyerésről." : "Motivációs poszt." }] }); res.json({ content: aiRes.choices[0].message.content }); });
app.post('/admin/draft-email', checkAdmin, async (req, res) => { const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Rövid hírlevél." }, { role: "user", content: req.body.topic }] }); res.json({ draft: aiRes.choices[0].message.content }); });
app.post('/user/update-bank', async (req, res) => { const amount = parseInt(req.body.amount); if (!isNaN(amount)) await User.findByIdAndUpdate(req.session.userId, { startingCapital: amount, currentBankroll: amount }); res.redirect('/dashboard'); });
app.post('/auth/login', async (req, res) => { const u = await User.findOne({ email: req.body.email.toLowerCase() }); if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); } else res.send("Hiba"); });
app.get('/login', (req, res) => res.render('login'));
app.get('/', (req, res) => res.render('index'));
app.listen(process.env.PORT || 8080);