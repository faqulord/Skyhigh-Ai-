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

// --- 50+ ZSIVÁNY ÜZENET ---
const FOX_QUOTES = [
    "FALKA FIGYELEM! Ma nem kérünk... Elveszünk! 🦊💰", "A buki a zsákmány, mi vagyunk a vadászok. 🎯",
    "A tőke a lőszer. Ne lövöldözz vaktában! 💣", "A statisztika nem hazudik. A bukméker igen. 📊",
    "Hideg fej, forró oddsok, tele zseb. Ez a Róka törvénye. 🦊", "Ne dolgozz a pénzért... Küldd el a pénzt dolgozni! 💸",
    "A kamatos kamat a világ nyolcadik csodája. 📈", "A türelem profitot terem, a kapkodás veszteséget. ⏳",
    "Miért sír a bukméker? Mert meglátta a Róka elemzését. 😂", "A szerencsejátékos reménykedik. A befektető számol. 📉",
    "Egy Róka sosem hibázik, csak néha teszteli a piacot. 😉", "A Falka nem ismer kegyelmet, csak profitot. 🐺",
    "A profit nem a cél, hanem a mellékterméke a jó mateknak. 💰", "Ülj le, dőlj hátra, és nézd, ahogy a gép dolgozik. 🦊",
    "Ma is egy nappal közelebb a pénzügyi szabadsághoz. 🚀", "A legjobb idő a tőkeépítésre tegnap volt. A második legjobb ma. 🔥",
    "Nem tippmixelünk. Vagyonkezelünk. 🏛️", "A bukmékernek nincs esélye az AI ellen. 🧠",
    "Kérdezték a Rókát, mi a titka. Azt mondta: Matek és semmi érzelem. 🦊", "Legyél te a vadász, ne a préda! 🎯",
    "A szoftver nem alszik, nem fárad, nem téved. 🤖✨", "A matek a közös nyelvünk. A profit a válaszunk. 📈"
];

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
    date: { type: String, index: true }, isReal: { type: Boolean, default: false }
}));

const SystemSetting = mongoose.models.SystemSetting || mongoose.model('SystemSetting', new mongoose.Schema({
    strategyMode: { type: String, default: 'normal' } 
}));

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 RÓKA MOTOR V70 - ONLINE`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    secret: 'fox_v70_secret', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- AUTH: REGISZTRÁCIÓ JAVÍTVA ---
app.post('/auth/register', async (req, res) => {
    try {
        const { fullname, email, password } = req.body;
        const hash = await bcrypt.hash(password, 10);
        const u = await new User({ fullname, email: email.toLowerCase(), password: hash }).save();
        req.session.userId = u._id;
        res.redirect('/dashboard');
    } catch (e) { res.send("Hiba a regisztráció során."); }
});

app.post('/auth/login', async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase() });
    if (u && await bcrypt.compare(req.body.password, u.password)) {
        req.session.userId = u._id; res.redirect('/dashboard');
    } else res.send("Hibás adatok.");
});

// --- BANKÁR: ID ALAPÚ LEZÁRÁS ---
app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    try {
        const { status, tipId } = req.body; 
        const tip = await Tip.findById(tipId);
        const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
        if (!tip || tip.status !== 'pending') return res.redirect('/admin');

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
    } catch (err) { console.error(err); }
    res.redirect('/admin');
});

// --- ROBOT & ADMIN ---
app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();
    try {
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        const matchData = response.data.matches.filter(m => m.status === 'TIMED').slice(0, 25).map(m => `${m.homeTeam.name} vs ${m.awayTeam.name}`).join("\n");
        const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Zsivány Róka AI. JSON." }, { role: "user", content: matchData }], response_format: { type: "json_object" } });
        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: targetDate }, { ...result, date: targetDate, isPublished: false, isReal: true, status: 'pending' }, { upsert: true });
    } catch (e) {} res.redirect('/admin');
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const pendingTips = await Tip.find({ status: 'pending' }).sort({ date: -1 });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(20);
    res.render('admin', { users, pendingTips, chatHistory, strategyMode: settings.strategyMode, brandName: BRAND_NAME });
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const bank = (user.currentBankroll && user.currentBankroll > 0) ? user.currentBankroll : user.startingCapital;
    res.render('dashboard', { user, dailyTip, suggestedStake: Math.round(bank * p), userBank: bank, strategyMode: settings.strategyMode, monthlyProfit: user.monthlyProfit || 0, foxQuotes: FOX_QUOTES, ownerEmail: OWNER_EMAIL, brandName: BRAND_NAME });
});

app.post('/admin/update-settings', checkAdmin, async (req, res) => { await SystemSetting.findOneAndUpdate({}, { strategyMode: req.body.mode }, { upsert: true }); res.redirect('/admin'); });
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });
app.post('/user/update-bank', async (req, res) => { const amount = parseInt(req.body.amount); if (!isNaN(amount)) await User.findByIdAndUpdate(req.session.userId, { startingCapital: amount, currentBankroll: amount }); res.redirect('/dashboard'); });
app.get('/stats', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const tips = await Tip.find({ status: { $ne: 'pending' } }).sort({ date: -1 }).limit(10);
    res.render('stats', { user, tips, wins: tips.filter(t=>t.status==='win').length, losses: tips.filter(t=>t.status==='loss').length, monthlyProfit: user.monthlyProfit || 0 });
});
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/', (req, res) => res.render('index'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(process.env.PORT || 8080);