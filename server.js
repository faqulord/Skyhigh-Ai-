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
const FOX_QUOTES = [
    "FALKA FIGYELEM! Ma nem kérünk... Elveszünk! 🦊💰",
    "A buki a zsákmány, mi vagyunk a vadászok. 🎯",
    "A tőke a lőszer. Ne lövöldözz vaktában! 💣",
    "Hideg fej, forró oddsok, tele zseb. Ez a Róka törvénye. 🦊"
];

// --- MODELLEK ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date, default: null }, isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 }, currentBankroll: { type: Number, default: 0 },
    monthlyProfit: { type: Number, default: 0 }, createdAt: { type: Date, default: Date.now }
}));

const Tip = mongoose.models.Tip || mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String, matchTime: String, 
    status: { type: String, default: 'pending' }, isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }, scannedMatches: { type: Number, default: 0 }
}));

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 RÓKA MOTOR ONLINE`));
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
    secret: 'fox_v81_final_master', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const u = await User.findById(req.session.userId);
    if (u && (u.isAdmin || u.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- JAVÍTOTT ROBOT LOGIKA ---
async function runAiRobot() {
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();

    try {
        await logToChat('System', "📡 Kapcsolódás a sportadatbázishoz...");
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        
        const allMatches = response.data.matches || [];
        const timedMatches = allMatches.filter(m => m.status === 'TIMED');
        
        // Jelzés az adminnak
        await logToChat('Róka', `🕵️‍♂️ Szimatolok... Összesen ${allMatches.length} meccset látok, ebből ${timedMatches.length} meccset elemzek ki éppen.`);

        const matchData = timedMatches.slice(0, 40).map(m => `[${m.competition.name}] ${m.homeTeam.name} vs ${m.awayTeam.name}`).join("\n");

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: "Te a Zsivány Róka AI vagy. Profi magyar sportfogadó. Szigorú JSON: league, match, prediction, odds, reasoning, memberMessage, matchTime." },
                { role: "user", content: `Válassz egy izgalmas meccset (lehetőleg ne ugyanazt, mint legutóbb)! Ne csak 1X2-t nézz, hanem gólokat (Pl. Over 2.5) vagy szögleteket is! Mivel nincs odds az API-ban, számolj egy REÁLIS odds-ot 1.60 és 2.50 között!\n\n${matchData}` }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: targetDate }, { ...result, date: targetDate, isPublished: false, status: 'pending', scannedMatches: allMatches.length }, { upsert: true });
        
        await logToChat('Róka', `🎯 Kész a jelentés! ${result.match} -> ${result.prediction} (@${result.odds}). Főnök, nézd meg az adminban!`);
    } catch (e) { await logToChat('System', `❌ HIBA: ${e.message}`); }
}

// --- ÚTVONALAK ---
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const pendingTips = await Tip.find({ status: 'pending' }).sort({ date: -1 });
    const bank = (user.currentBankroll > 0) ? user.currentBankroll : (user.startingCapital || 0);
    res.render('dashboard', { user, dailyTip, pendingTips, suggestedStake: Math.round(bank * 0.03), userBank: bank, strategyMode: 'normal', monthlyProfit: user.monthlyProfit || 0, foxQuotes: FOX_QUOTES, ownerEmail: OWNER_EMAIL, brandName: BRAND_NAME });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const pendingTips = await Tip.find({ status: 'pending' }).sort({ date: -1 });
    const chatHistory = await ChatMessage.find().sort({ timestamp: -1 }).limit(30);
    const lastTip = await Tip.findOne().sort({ _id: -1 });
    const scannedCount = lastTip ? lastTip.scannedMatches : 0;
    res.render('admin', { users, pendingTips, chatHistory, scannedCount, brandName: BRAND_NAME });
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => { await runAiRobot(); res.redirect('/admin'); });

app.post('/admin/chat', checkAdmin, async (req, res) => {
    const aiRes = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{ role: "system", content: "Te a Zsivány Róka vagy. KIZÁRÓLAG MAGYARUL válaszolj dörzsölt stílusban!" }, { role: "user", content: req.body.message }]
    });
    res.json({ reply: aiRes.choices[0].message.content });
});

app.post('/admin/generate-insta', checkAdmin, async (req, res) => {
    const tip = await Tip.findOne({ date: getDbDate() });
    if (!tip) return res.json({ caption: "Nincs mára tipp, amit posztolhatnék!" });
    const aiRes = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{ role: "system", content: "Írj egy ütős Instagram posztot emojikkal!" }, { role: "user", content: `Meccs: ${tip.match}, Tipp: ${tip.prediction}, Odds: ${tip.odds}` }]
    });
    res.json({ caption: aiRes.choices[0].message.content });
});

app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const { status, tipId } = req.body;
    const tip = await Tip.findById(tipId);
    const users = await User.find({ isAdmin: false });
    for (let u of users) {
        let bank = (u.currentBankroll > 0) ? u.currentBankroll : u.startingCapital;
        let stake = Math.round(bank * 0.03);
        let oddsNum = parseFloat(tip.odds.toString().replace(',', '.'));
        let profit = (status === 'win') ? Math.round(stake * (oddsNum - 1)) : -stake;
        u.currentBankroll = bank + profit; u.monthlyProfit += profit; await u.save();
    }
    tip.status = status; await tip.save();
    await logToChat('System', `🏁 Eredmény: ${tip.match} -> ${status.toUpperCase()}`);
    res.redirect('/admin');
});

app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });

app.post('/auth/login', async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase() });
    if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); } else res.send("Hiba");
});

app.get('/login', (req, res) => res.render('login', { brandName: BRAND_NAME }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(process.env.PORT || 8080);