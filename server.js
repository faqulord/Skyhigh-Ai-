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

// --- MODELLEK ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date }, isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 },
    currentBankroll: { type: Number, default: 0 } 
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

const MonthlyStat = mongoose.models.MonthlyStat || mongoose.model('MonthlyStat', new mongoose.Schema({
    month: String, totalProfit: { type: Number, default: 0 }, winCount: { type: Number, default: 0 }, 
    lossCount: { type: Number, default: 0 }, totalTips: { type: Number, default: 0 }, isPublished: { type: Boolean, default: false }
}));

// --- SEGÉDFÜGGVÉNYEK ---
const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });

mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 Rendszer Visszaállítva - v32.5`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- RÓKA AGYA ---
async function runAiRobot() {
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();
    try {
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        const matches = response.data.matches || [];
        let fixtures = matches.filter(m => {
            const h = parseInt(new Date(m.utcDate).toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', hour12: false }));
            return h >= 13 && m.status === 'TIMED';
        });
        if (fixtures.length === 0) return false;

        const matchData = fixtures.slice(0, 10).map(m => `${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`).join("\n");
        
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Te vagy a Zsivány Róka. JSON: { \"league\":\"\", \"match\":\"\", \"prediction\":\"\", \"odds\":\"\", \"reasoning\":\"\", \"matchTime\":\"HH:mm\" }" }, { role: "user", content: matchData }],
            response_format: { type: "json_object" }
        });
        const result = JSON.parse(aiRes.choices[0].message.content);

        const marketingRes = await openai.chat.completions.create({
             model: "gpt-4-turbo-preview",
             messages: [{ role: "system", content: "Zsivány Róka stílus. Rövid, dörzsölt üzenet, 1 vicc a végén." }, { role: "user", content: `Meccs: ${result.match}, Tipp: ${result.prediction}` }] 
        });

        await Tip.findOneAndUpdate({ date: targetDate }, { 
            ...result, memberMessage: marketingRes.choices[0].message.content,
            date: targetDate, isPublished: false, isReal: true, status: 'pending'
        }, { upsert: true });
        return true;
    } catch (e) { return false; }
}

const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const u = await User.findById(req.session.userId);
    if (u && (u.isAdmin || u.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- ÚTVONALAK ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'fox_restore_secret', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    
    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const bank = user.currentBankroll || user.startingCapital || 0;
    
    res.render('dashboard', { 
        user, dailyTip, suggestedStake: Math.round(bank * p), userBank: bank, strategyMode: settings.strategyMode,
        displayDate: new Date().toLocaleDateString('hu-HU'), 
        foxQuotes: ["A buki már izzad.", "Pénz beszél, Róka vadászik.", "A tőke a lőszered!"] 
    });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(20);
    res.render('admin', { users, currentTip, chatHistory, strategyMode: settings.strategyMode, dbDate: getDbDate(), brandName: BRAND_NAME, stats: [] });
});

app.post('/admin/update-settings', checkAdmin, async (req, res) => {
    await SystemSetting.findOneAndUpdate({}, { strategyMode: req.body.mode }, { upsert: true });
    res.redirect('/admin');
});

app.post('/admin/refine-text', checkAdmin, async (req, res) => {
    const tip = await Tip.findOne({ date: getDbDate() });
    if (!tip) return res.redirect('/admin');
    const refined = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{ role: "system", content: "Legyél rövidebb!" }, { role: "user", content: tip.memberMessage }]
    });
    // CSAK A SZÖVEGET FRISSÍTJÜK, A MATCHTIME MARAD!
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
        let s = b * p;
        if (req.body.status === 'win') b += (s * (parseFloat(tip.odds) - 1));
        else b -= s;
        u.currentBankroll = Math.round(b);
        await u.save();
    }
    tip.status = req.body.status;
    await tip.save();
    res.redirect('/admin');
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => { await runAiRobot(); res.redirect('/admin'); });
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });
app.post('/user/update-bank', async (req, res) => {
    const amount = parseInt(req.body.amount);
    if (!isNaN(amount)) await User.findByIdAndUpdate(req.session.userId, { startingCapital: amount, currentBankroll: amount });
    res.redirect('/dashboard');
});

app.post('/auth/login', async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase() });
    if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); }
    else res.send("Hiba");
});
app.get('/login', (req, res) => res.render('login'));
app.get('/', (req, res) => res.render('index'));
app.listen(process.env.PORT || 8080);