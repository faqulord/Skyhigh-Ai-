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
const FOX_QUOTES = ["FALKA FIGYELEM! Ma nem kérünk... Elveszünk! 🦊💰", "A tőke a lőszer! 💣", "A szoftver nem alszik. 🤖"];

// --- MODELLEK ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date, default: null }, isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 }, currentBankroll: { type: Number, default: 0 },
    monthlyProfit: { type: Number, default: 0 } 
}));

const Tip = mongoose.models.Tip || mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String, matchTime: String, 
    status: { type: String, default: 'pending' }, isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }
}));

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 RÓKA MOTOR V80 - ONLINE`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function logToChat(sender, message) {
    const timeStr = new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit' });
    await new ChatMessage({ sender, text: `[${timeStr}] ${message}` }).save();
}

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'fox_v80_restored', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const u = await User.findById(req.session.userId);
    if (u && (u.isAdmin || u.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- ROBOT: ÚJ ELEMZÉS (AZONNALI JELENTÉSSEL) ---
async function runAiRobot() {
    await ChatMessage.deleteMany({});
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();

    try {
        await logToChat('System', "📡 Friss adatok lekérése...");
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        const matches = response.data.matches.filter(m => m.status === 'TIMED').slice(0, 30);
        
        const matchData = matches.map(m => `[${m.competition.name}] ${m.homeTeam.name} vs ${m.awayTeam.name}`).join("\n");
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Zsivány Róka AI. JSON: league, match, prediction, odds, reasoning, memberMessage, matchTime." }, { role: "user", content: `Válassz egy meccset, ami NEM a tegnapi volt! Kínálat:\n${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        // Frissítjük a mai tippet
        await Tip.findOneAndUpdate({ date: targetDate }, { ...result, isPublished: false, status: 'pending' }, { upsert: true });
        await logToChat('Róka', `✅ Új jelentés kész: ${result.match}. Várom a jóváhagyást!`);
    } catch (e) { await logToChat('System', `❌ HIBA: ${e.message}`); }
}

// --- DASHBOARD FIX: PENDINGTIPS HOZZÁADVA ---
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    
    // EZ HIÁNYZOTT! Emiatt volt a fehér lap.
    const pendingTips = await Tip.find({ status: 'pending' }).sort({ date: -1 });

    const bank = (user.currentBankroll > 0) ? user.currentBankroll : (user.startingCapital || 0);
    res.render('dashboard', { 
        user, dailyTip, pendingTips, suggestedStake: Math.round(bank * 0.03), userBank: bank, 
        strategyMode: 'normal', monthlyProfit: user.monthlyProfit || 0, 
        foxQuotes: FOX_QUOTES, ownerEmail: OWNER_EMAIL, brandName: BRAND_NAME 
    });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const pendingTips = await Tip.find({ status: 'pending' }).sort({ date: -1 });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 });
    res.render('admin', { users, pendingTips, chatHistory, strategyMode: 'normal', brandName: BRAND_NAME });
});

// MARKETING AI ÚTVONALAK
app.post('/admin/social-content', checkAdmin, async (req, res) => {
    const { type } = req.body;
    const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "user", content: `Írj egy Insta posztot: ${type}` }] });
    res.json({ content: aiRes.choices[0].message.content });
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => { await runAiRobot(); res.redirect('/admin'); });
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });
app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const { status, tipId } = req.body;
    const tip = await Tip.findById(tipId);
    const users = await User.find({ isAdmin: false });
    for (let u of users) {
        let bank = (u.currentBankroll > 0) ? u.currentBankroll : u.startingCapital;
        let stake = Math.round(bank * 0.03);
        let profit = (status === 'win') ? Math.round(stake * (parseFloat(tip.odds) - 1)) : -stake;
        u.currentBankroll = bank + profit; u.monthlyProfit += profit; await u.save();
    }
    tip.status = status; await tip.save(); res.redirect('/admin');
});

app.post('/auth/login', async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase() });
    if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); } else res.send("Hiba");
});

app.get('/login', (req, res) => res.render('login', { brandName: BRAND_NAME }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(process.env.PORT || 8080);