
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const nodemailer = require('nodemailer');
const https = require('https');
const path = require('path');
const app = express();

const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const BRAND_NAME = "Zsivány Róka"; 

// --- MODELLEK (FRISSÍTVE) ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date }, isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 },
    currentBankroll: { type: Number, default: 0 }, // Kamatos kamat alapja
    monthlyProfit: { type: Number, default: 0 }   // Havi statisztika
}));

const Tip = mongoose.models.Tip || mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String, profitPercent: { type: Number, default: 0 }, 
    matchTime: String, matchDate: String, bookmaker: String, recommendedStake: { type: String, default: "3%" },
    status: { type: String, default: 'pending' }, isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }, isReal: { type: Boolean, default: false }
}));

const SystemSetting = mongoose.models.SystemSetting || mongoose.model('SystemSetting', new mongoose.Schema({
    strategyMode: { type: String, default: 'normal' } 
}));

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

// --- SEGÉDFÜGGVÉNYEK ---
const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });

async function logToChat(sender, message) {
    const timeStr = new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });
    await new ChatMessage({ sender, text: `[${timeStr}] ${message}` }).save();
}

mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 System Ready - Zsivány Motor v77`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- RÓKA ELEMZÉS (V30 EREDETI LOGIKA) ---
async function runAiRobot() {
    await ChatMessage.deleteMany({});
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();

    try {
        const response = await axios.get(`https://api.football-data.org/v4/matches`, {
            headers: { 'X-Auth-Token': token }
        });

        const matches = response.data.matches || [];
        let validFixtures = matches.filter(m => {
            const matchDate = new Date(m.utcDate);
            const hunHour = parseInt(matchDate.toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', hour12: false }));
            return hunHour >= 13 && hunHour <= 23 && m.status === 'TIMED';
        });

        await logToChat('System', `📡 Adat érkezett: ${validFixtures.length} alkalmas meccs.`);
        if (validFixtures.length === 0) {
            await logToChat('Róka', `⚠️ Ma már nincs több zsivány meccs a listán.`);
            return false;
        }

        const matchData = validFixtures.slice(0, 30).map(m => {
            const time = new Date(m.utcDate).toLocaleTimeString('hu-HU', {timeZone:'Europe/Budapest', hour:'2-digit', minute:'2-digit'});
            return `[${time}] ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`;
        }).join("\n");

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ 
                role: "system", 
                content: `Te vagy a Zsivány Róka, egy dörzsölt sportelemző. Válaszd ki a legbiztosabb kimenetelt. JSON FORMAT: { "league": "...", "match": "...", "prediction": "...", "odds": "1.XX", "reasoning": "...", "matchTime": "ÓÓ:PP" }`
            }, { role: "user", content: `Kínálat:\n${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        const mDate = new Date().toLocaleDateString('hu-HU');
        const marketingRes = await openai.chat.completions.create({
             model: "gpt-4-turbo-preview",
             messages: [{ role: "system", content: "Zsivány Róka stílus. Rövid, magabiztos, 1 zsivány vicc a végén." }, { role: "user", content: `Dátum: ${mDate}, Meccs: ${result.match}, Tipp: ${result.prediction}.` }] 
        });

        await Tip.findOneAndUpdate({ date: targetDate }, { 
            ...result, 
            memberMessage: marketingRes.choices[0].message.content,
            date: targetDate, isPublished: false, isReal: true, status: 'pending'
        }, { upsert: true });

        await logToChat('Róka', `✅ Kész! Választott: ${result.match}`);
        return true;
    } catch (e) {
        await logToChat('System', `⚠️ HIBA: ${e.message}`);
        return false;
    }
}

// --- MIDDLEWARE & SESSION ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'v77_fox_empire', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- BANKÁR: WIN/LOSS LEZÁRÁS ÉS KAMATOS KAMAT ---
app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    try {
        const { status, tipId } = req.body; 
        const tip = await Tip.findById(tipId);
        const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
        if (!tip || tip.status !== 'pending') return res.redirect('/admin');

        // Stratégia alapú kockázat (3% alap, 1.5% óvatos, 6% agresszív)
        let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
        const users = await User.find({ isAdmin: false });

        for (let u of users) {
            let bank = (u.currentBankroll && u.currentBankroll > 0) ? u.currentBankroll : u.startingCapital;
            if (bank > 0) {
                let stake = Math.round(bank * p);
                let profit = (status === 'win') ? Math.round(stake * (parseFloat(tip.odds) - 1)) : -stake;
                u.currentBankroll = bank + profit;
                u.monthlyProfit = (u.monthlyProfit || 0) + profit;
                await u.save();
            }
        }
        tip.status = status; await tip.save();
        await logToChat('System', `💰 Pénzügyi zárás: ${tip.match} -> ${status.toUpperCase()}`);
    } catch (err) { console.error(err); }
    res.redirect('/admin');
});

// --- DASHBOARD (LICENC ELLENŐRZÉSSEL) ---
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    
    // Licenc lejárat check
    if (user.licenseExpiresAt && new Date() > new Date(user.licenseExpiresAt)) {
        user.hasLicense = false; await user.save();
    }
    if (!user.isAdmin && user.email !== OWNER_EMAIL && !user.hasLicense) {
        return res.render('sales', { user, brandName: BRAND_NAME });
    }

    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const bank = (user.currentBankroll && user.currentBankroll > 0) ? user.currentBankroll : user.startingCapital;

    res.render('dashboard', { 
        user, dailyTip, 
        suggestedStake: Math.round(bank * p), 
        userBank: bank,
        strategyMode: settings.strategyMode,
        monthlyProfit: user.monthlyProfit || 0,
        brandName: BRAND_NAME,
        ownerEmail: OWNER_EMAIL,
        foxQuotes: ["FALKA! A matek az egyetlen barátod."],
        displayDate: new Date().toLocaleDateString('hu-HU')
    });
});

// --- ADMIN HQ (FÜGGŐ MECCSEKKEL) ---
app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const pendingTips = await Tip.find({ status: 'pending' }).sort({ date: -1 });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(50);
    res.render('admin', { users, pendingTips, chatHistory, strategyMode: settings.strategyMode, brandName: BRAND_NAME, ownerEmail: OWNER_EMAIL });
});

// TAGOK AKTIVÁLÁSA
app.post('/admin/manage-sub', checkAdmin, async (req, res) => {
    const { userId, action } = req.body;
    const u = await User.findById(userId);
    if (u) {
        if (action === 'add30') {
            let base = (u.licenseExpiresAt && u.licenseExpiresAt > new Date()) ? u.licenseExpiresAt : new Date();
            u.licenseExpiresAt = new Date(base.getTime() + 30*24*60*60*1000); u.hasLicense = true;
        } else u.hasLicense = false;
        await u.save();
    } res.redirect('/admin');
});

// EGYÉB FUNKCIÓK
app.post('/admin/run-robot', checkAdmin, async (req, res) => { await runAiRobot(); res.redirect('/admin'); });
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });
app.post('/admin/update-settings', checkAdmin, async (req, res) => { await SystemSetting.findOneAndUpdate({}, { strategyMode: req.body.mode }, { upsert: true }); res.redirect('/admin'); });
app.post('/user/update-bank', async (req, res) => { 
    const amt = parseInt(req.body.amount); 
    if (!isNaN(amt)) await User.findByIdAndUpdate(req.session.userId, { startingCapital: amt, currentBankroll: amt }); 
    res.redirect('/dashboard'); 
});

app.post('/auth/login', async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase() });
    if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); }
    else res.send("Hiba");
});

app.get('/login', (req, res) => res.render('login', { brandName: BRAND_NAME }));
app.get('/register', (req, res) => res.render('register', { brandName: BRAND_NAME }));
app.get('/terms', (req, res) => res.render('terms', { brandName: BRAND_NAME }));
app.get('/', (req, res) => res.render('index', { brandName: BRAND_NAME }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(process.env.PORT || 8080);