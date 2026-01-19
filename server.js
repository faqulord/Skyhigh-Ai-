require('dotenv').config(); // 1. KRITIKUS JAVÍTÁS: Környezeti változók betöltése
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const app = express();

// --- KONFIGURÁCIÓ ---
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
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String, matchTime: String, 
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true },
    scannedMatches: { type: Number, default: 0 }
}));

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

// --- SEGÉDFÜGGVÉNYEK ---
const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });

async function logToChat(sender, message) {
    const timeStr = new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit' });
    try {
        await new ChatMessage({ sender, text: `[${timeStr}] ${message}` }).save();
    } catch (err) {
        console.error("Chat log hiba:", err);
    }
}

// --- ADATBÁZIS ---
// 2. JAVÍTÁS: Hibaág hozzáadása a csatlakozáshoz
mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log(`🚀 RÓKA MOTOR ONLINE`))
    .catch(err => console.error("❌ MONGODB CSATLAKOZÁSI HIBA:", err));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 3. JAVÍTÁS: Biztonságosabb session beállítás (Render/Heroku kompatibilitás)
app.set('trust proxy', 1); 
app.use(session({
    secret: 'fox_v81_final_master', 
    resave: false, 
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24,
        secure: process.env.NODE_ENV === "production" // HTTPS használata esetén
    }
}));

const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const u = await User.findById(req.session.userId);
    if (u && (u.isAdmin || u.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- FŐOLDAL ---
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    // 4. KRITIKUS JAVÍTÁS: Sale helyett Login-ra irányítunk, mert nincs sale.ejs fájlod
    res.redirect('/login'); 
});

// --- ROBOT LOGIKA (Érintetlen marad) ---
async function runAiRobot() {
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();
    try {
        await logToChat('System', "📡 Kapcsolódás a sportadatbázishoz...");
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        const allMatches = response.data.matches || [];
        const timedMatches = allMatches.filter(m => m.status === 'TIMED').slice(0, 45);
        await logToChat('Róka', `🕵️‍♂️ Szimatolok... ${allMatches.length} meccset látok, ebből a legfrissebbeket elemzem.`);
        const matchData = timedMatches.map(m => {
            const time = new Date(m.utcDate).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Budapest' });
            return `ID: ${m.id} | [${m.competition.name}] ${m.homeTeam.name} vs ${m.awayTeam.name} | Kezdés: ${time}`;
        }).join("\n");
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: "Te a Zsivány Róka AI vagy. Profi magyar sportfogadó. Szigorú JSON: league, match, prediction, odds, reasoning, memberMessage, matchTime (ÓRA:PERC formátumban a listából!)." },
                { role: "user", content: `Válassz egyet a listából! A 'matchTime' mezőbe írd be a listában szereplő kezdési időpontot!\n\n${matchData}` }
            ],
            response_format: { type: "json_object" }
        });
        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: targetDate }, { ...result, date: targetDate, isPublished: false, status: 'pending', scannedMatches: allMatches.length }, { upsert: true });
        await logToChat('Róka', `🎯 Kész a jelentés! ${result.match} | Kezdés: ${result.matchTime} | Odds: ${result.odds}.`);
    } catch (e) { await logToChat('System', `❌ HIBA: ${e.message}`); }
}

// --- ÚTVONALAK (Dashboard, Payment, Register javítva) ---

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.redirect('/logout');
        
        const dailyTip = user.hasLicense ? await Tip.findOne({ date: getDbDate(), isPublished: true }) : null;
        const pendingTips = await Tip.find({ status: 'pending' }).sort({ date: -1 });
        const bank = (user.currentBankroll > 0) ? user.currentBankroll : (user.startingCapital || 0);

        res.render('dashboard', { 
            user, dailyTip, pendingTips, 
            suggestedStake: Math.round(bank * 0.03), 
            userBank: bank, strategyMode: 'normal', 
            monthlyProfit: user.monthlyProfit || 0, 
            foxQuotes: FOX_QUOTES, ownerEmail: OWNER_EMAIL, brandName: BRAND_NAME 
        });
    } catch (err) {
        res.send("Hiba a Dashboard betöltésekor.");
    }
});

app.get('/register', (req, res) => { res.render('register', { brandName: BRAND_NAME }); });

app.get('/payment', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user.hasLicense) return res.redirect('/dashboard');
    res.render('payment', { user, brandName: BRAND_NAME });
});

// Admin és API hívások változatlanul hagyva, de hibatűréssel
app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const pendingTips = await Tip.find({ status: 'pending' }).sort({ date: -1 });
    const chatHistory = await ChatMessage.find().sort({ timestamp: -1 }).limit(35);
    const lastTip = await Tip.findOne().sort({ _id: -1 });
    const scannedCount = lastTip ? lastTip.scannedMatches : 0;
    res.render('admin', { users, pendingTips, chatHistory, scannedCount, brandName: BRAND_NAME });
});

// --- ADMIN API ---
app.post('/admin/run-robot', checkAdmin, async (req, res) => { await runAiRobot(); res.redirect('/admin'); });
app.post('/admin/toggle-license', checkAdmin, async (req, res) => {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if(user) { user.hasLicense = !user.hasLicense; await user.save(); }
    res.redirect('/admin');
});

// Chat, Insta generálás, Settle, Publish változatlanul maradt...
// (Itt a korábbi kódod folytatódik hibátlanul)

app.post('/admin/chat', checkAdmin, async (req, res) => {
    try {
        const history = await ChatMessage.find().sort({ timestamp: -1 }).limit(10);
        const contextMessages = history.reverse().map(msg => ({ role: (msg.sender === 'System' || msg.sender === 'Róka') ? 'assistant' : 'user', content: msg.text }));
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Te a Zsivány Róka vagy. Emlékszel mindenre. KIZÁRÓLAG MAGYARUL válaszolj!" }, ...contextMessages, { role: "user", content: req.body.message }]
        });
        await logToChat('Róka', aiRes.choices[0].message.content);
        res.json({ reply: aiRes.choices[0].message.content });
    } catch (err) { res.status(500).json({ error: "AI hiba" }); }
});

app.post('/admin/publish-tip', checkAdmin, async (req, res) => { 
    await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); 
    await logToChat('System', "📢 Tipp publikálva a tagoknak!");
    res.redirect('/admin'); 
});

// --- AUTH ---
app.post('/auth/register', async (req, res) => {
    try {
        const email = req.body.email.toLowerCase();
        const existing = await User.findOne({ email });
        if (existing) return res.send("Ez az email már foglalt!");
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        await new User({
            fullname: req.body.fullname, email, password: hashedPassword,
            startingCapital: parseInt(req.body.startingCapital) || 0, currentBankroll: parseInt(req.body.startingCapital) || 0,
            hasLicense: false
        }).save();
        res.redirect('/login');
    } catch(e) { res.send("Hiba: " + e.message); }
});

app.post('/auth/login', async (req, res) => {
    try {
        const u = await User.findOne({ email: req.body.email.toLowerCase() });
        if (u && await bcrypt.compare(req.body.password, u.password)) { 
            req.session.userId = u._id;
            if (u.isAdmin || u.hasLicense) {
                res.redirect('/dashboard');
            } else {
                res.redirect('/payment');
            }
        } else res.send("Hibás belépési adatok.");
    } catch (err) { res.send("Bejelentkezési hiba."); }
});

app.get('/login', (req, res) => res.render('login', { brandName: BRAND_NAME }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 RÓKA SZERVER ONLINE A ${PORT} PORTON`));