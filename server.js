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

// --- MODELLEK FRISSÍTÉSE ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, 
    email: { type: String, unique: true, lowercase: true },
    password: String, 
    hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date, default: null }, 
    isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 }, 
    currentBankroll: { type: Number, default: 0 },
    monthlyProfit: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
}));

const Tip = mongoose.models.Tip || mongoose.model('Tip', new mongoose.Schema({
    league: String, 
    match: String, 
    prediction: String, 
    odds: String, 
    reasoning: String, 
    memberMessage: String, 
    matchTime: String, 
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true },
    scannedMatches: { type: Number, default: 0 } // ÚJ: Itt tároljuk, hány meccset nézett át a robot
}));

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, 
    text: String, 
    timestamp: { type: Date, default: Date.now }
}));

const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });

// Adatbázis kapcsolat
mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log(`🚀 RÓKA MOTOR V81 - ONLINE`))
    .catch(err => console.error("Adatbázis hiba:", err));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- JAVÍTOTT NAPLÓZÁS ---
async function logToChat(sender, message) {
    const timeStr = new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit' });
    // Itt NEM töröljük a régit, hanem hozzáadjuk az újat
    await new ChatMessage({ sender, text: `[${timeStr}] ${message}` }).save();
}

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'fox_v81_final_master', 
    resave: true, 
    saveUninitialized: true,
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
    // KIVÉVE: ChatMessage.deleteMany({}) - Ne töröljük a jelentéseket!
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();

    try {
        await logToChat('System', "📡 Kapcsolódás a sportadatbázishoz...");
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        
        // Összes meccs megszámlálása
        const allMatches = response.data.matches || [];
        const totalFound = allMatches.length;
        
        // Csak a jövőbeli meccsek szűrése
        const matches = allMatches.filter(m => m.status === 'TIMED').slice(0, 30);
        
        await logToChat('System', `🔍 ${totalFound} meccset találtam, ebből 30-at küldök elemzésre a Rókának...`);

        const matchData = matches.map(m => `[${m.competition.name}] ${m.home_team_name || m.homeTeam.name} vs ${m.away_team_name || m.awayTeam.name}`).join("\n");
        
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: "Te a Zsivány Róka AI vagy. KIZÁRÓLAG MAGYARUL VÁLASZOLJ! Szigorú JSON formátum: league, match, prediction, odds, reasoning, memberMessage, matchTime." },
                { role: "user", content: `Válassz egy meccset, ami a legbiztosabb tipp! Adj hozzá reális odds-ot (1.50 és 2.40 között) és dörzsölt, profi magyar elemzést!\n${matchData}` }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        
        // Mentés az adatbázisba az átvizsgált számmal együtt
        await Tip.findOneAndUpdate(
            { date: targetDate }, 
            { ...result, date: targetDate, isPublished: false, status: 'pending', scannedMatches: totalFound }, 
            { upsert: true }
        );
        
        await logToChat('Róka', `✅ Új jelentés: ${result.match} (${result.odds}). Főnök, a rendszer várja a jóváhagyást!`);
    } catch (e) { 
        await logToChat('System', `❌ HIBA a robot futása közben: ${e.message}`); 
    }
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

// JAVÍTOTT ADMIN ÚTVONAL
app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const pendingTips = await Tip.find({ status: 'pending' }).sort({ date: -1 });
    const chatHistory = await ChatMessage.find().sort({ timestamp: -1 }).limit(20); // Utolsó 20 üzenet
    
    // Lekérjük az utolsó átvizsgálási számot
    const lastTip = await Tip.findOne().sort({ _id: -1 });
    const scannedCount = lastTip ? lastTip.scannedMatches : 0;

    res.render('admin', { users, pendingTips, chatHistory, scannedCount, strategyMode: 'normal', brandName: BRAND_NAME });
});

// --- HIÁNYZÓ MENÜPONTOK ÚTVONALAI ---

// 1. TAGOK KEZELÉSE
app.get('/admin/members', checkAdmin, async (req, res) => {
    const members = await User.find().sort({ createdAt: -1 });
    res.render('admin_members', { members, brandName: BRAND_NAME });
});

// 2. PÉNZÜGYEK
app.get('/admin/finance', checkAdmin, async (req, res) => {
    const users = await User.find();
    const stats = {
        totalBank: users.reduce((s, u) => s + (u.currentBankroll || 0), 0),
        totalProfit: users.reduce((s, u) => s + (u.monthlyProfit || 0), 0),
        activeUsers: users.filter(u => u.hasLicense).length
    };
    res.render('admin_finance', { stats, users, brandName: BRAND_NAME });
});

// 3. EMAIL RENDSZER
app.get('/admin/email', checkAdmin, async (req, res) => {
    res.render('admin_email', { brandName: BRAND_NAME });
});

// --- ADMIN MŰVELETEK ---
app.post('/admin/run-robot', checkAdmin, async (req, res) => { await runAiRobot(); res.redirect('/admin'); });

app.post('/admin/publish-tip', checkAdmin, async (req, res) => { 
    await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); 
    await logToChat('System', "📢 A tipp kiküldve a tagoknak!");
    res.redirect('/admin'); 
});

app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const { status, tipId } = req.body;
    const tip = await Tip.findById(tipId);
    if (!tip) return res.redirect('/admin');

    const users = await User.find({ isAdmin: false });
    for (let u of users) {
        let bank = (u.currentBankroll > 0) ? u.currentBankroll : u.startingCapital;
        let stake = Math.round(bank * 0.03);
        let oddsNum = parseFloat(tip.odds.replace(',', '.')); // Biztonságos odds átalakítás
        let profit = (status === 'win') ? Math.round(stake * (oddsNum - 1)) : -stake;
        
        u.currentBankroll = bank + profit; 
        u.monthlyProfit += profit; 
        await u.save();
    }
    tip.status = status; 
    await tip.save(); 
    await logToChat('System', `🏁 Eredmény rögzítve: ${tip.match} -> ${status.toUpperCase()}`);
    res.redirect('/admin');
});

// --- AUTH ---
app.post('/auth/login', async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase() });
    if (u && await bcrypt.compare(req.body.password, u.password)) { 
        req.session.userId = u._id; 
        res.redirect('/dashboard'); 
    } else res.send("Hibás belépési adatok.");
});

app.get('/login', (req, res) => res.render('login', { brandName: BRAND_NAME }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Szerver fut a ${PORT} porton`));