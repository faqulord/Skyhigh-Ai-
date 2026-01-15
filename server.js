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

// --- MODELLEK (User és Tip bővítve a bankár funkcióhoz) ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date }, isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 },
    currentBankroll: { type: Number, default: 0 } // ÚJ: Itt tároljuk a gyarapodó tőkét
}));

const Tip = mongoose.models.Tip || mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String, profitPercent: { type: Number, default: 0 }, 
    matchTime: String, matchDate: String, bookmaker: String, recommendedStake: { type: String, default: "3%" },
    status: { type: String, default: 'pending' }, // ÚJ: pending / win / loss
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }, isReal: { type: Boolean, default: false }
}));

const MonthlyStat = mongoose.models.MonthlyStat || mongoose.model('MonthlyStat', new mongoose.Schema({
    month: String, totalProfit: { type: Number, default: 0 }, winCount: { type: Number, default: 0 }, 
    lossCount: { type: Number, default: 0 }, totalTips: { type: Number, default: 0 }, isPublished: { type: Boolean, default: false }
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

mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 System Ready - Zsivány Motor v30.1 (Banker Edition)`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- RÓKA ELEMZÉS (VÁLTOZATLAN) ---
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
             messages: [{ role: "system", content: "Zsivány Róka stílus. Rövid, magabiztos, 1 zsivány vicc a végén." }, { role: "user", content: `Írd meg a tagoknak: Dátum: ${mDate}, Idő: ${result.matchTime}, Meccs: ${result.match}, Tipp: ${result.prediction}.` }] 
        });

        await Tip.findOneAndUpdate({ date: targetDate }, { 
            ...result, memberMessage: marketingRes.choices[0].message.content,
            date: targetDate, isPublished: false, isReal: true 
        }, { upsert: true });

        await logToChat('Róka', `✅ Kész! Választott: ${result.match}`);
        return true;
    } catch (e) {
        await logToChat('System', `⚠️ HIBA: ${e.message}`);
        return false;
    }
}

// --- ADMIN ÉS FELHASZNÁLÓI ÚTVONALAK ---
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- ÚJ: BANKÁR ELSZÁMOLÁS LOGIKA (Admin hívja meg) ---
app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const { status } = req.body; 
    const today = getDbDate();
    const tip = await Tip.findOne({ date: today });

    if (!tip || tip.status !== 'pending') return res.redirect('/admin');

    const users = await User.find({ isAdmin: false });
    const odds = parseFloat(tip.odds);
    const stakePercent = 0.03; // Fix 3% Zsivány Szabály

    for (let user of users) {
        let bank = user.currentBankroll || user.startingCapital || 0;
        let stake = bank * stakePercent;

        if (status === 'win') {
            bank += (stake * (odds - 1));
        } else if (status === 'loss') {
            bank -= stake;
        }
        user.currentBankroll = Math.round(bank);
        await user.save();
    }

    tip.status = status;
    await tip.save();
    res.redirect('/admin');
});

// --- ÚJ: FELHASZNÁLÓI BANK BEÁLLÍTÁSA ---
app.post('/user/update-bank', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const amount = parseInt(req.body.amount);
    if (!isNaN(amount) && amount > 0) {
        await User.findByIdAndUpdate(req.session.userId, { 
            startingCapital: amount, 
            currentBankroll: amount 
        });
    }
    res.redirect('/dashboard');
});

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'v30_fox_brain', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

app.post('/admin/refine-text', checkAdmin, async (req, res) => {
    const tip = await Tip.findOne({ date: getDbDate() });
    if (!tip) return res.redirect('/admin');
    const refined = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{ role: "system", content: "Zsivány Róka vagy. Vedd rövidebbre!" }, { role: "user", content: tip.memberMessage }]
    });
    tip.memberMessage = refined.choices[0].message.content;
    await tip.save();
    res.redirect('/admin');
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(50);
    res.render('admin', { users, currentTip, chatHistory, dbDate: getDbDate(), brandName: BRAND_NAME, recentTips: [], stats: [], calculatorData: [] });
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => { await runAiRobot(); res.redirect('/admin'); });
app.post('/admin/delete-today', checkAdmin, async (req, res) => { await Tip.findOneAndDelete({ date: getDbDate() }); res.redirect('/admin'); });
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });

// --- DASHBOARD: BANKÁR SZÁMÍTÁSOK ---
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    
    // Személyi Bankár számítás
    const userBank = user.currentBankroll || user.startingCapital || 0;
    const suggestedStake = Math.round(userBank * 0.03);

    res.render('dashboard', { 
        user, dailyTip, suggestedStake, userBank,
        displayDate: new Date().toLocaleDateString('hu-HU'), 
        foxQuotes: ["A tőke szent.", "A buki már fél.", "Zsivány becsület."], 
        streak: 0 
    });
});

app.post('/auth/login', async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase() });
    if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); }
    else res.send("Hiba");
});

app.get('/login', (req, res) => res.render('login'));
app.get('/', (req, res) => res.render('index'));
app.listen(process.env.PORT || 8080);