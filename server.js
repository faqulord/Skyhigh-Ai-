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

// --- RÓKA DUMÁK (EREDETI) ---
const foxQuotes = [
    "📞 Hallod Főnök? A bukméker már remeg, ha meglátja a logónkat! 🦊💦",
    "🍗 Ma este nem vacsorázunk... ma este LAKOMÁZUNK a buki pénzéből!",
    "🥷 Hozd a símaszkot, a mai meccsek őrizetlenül hagyták a kasszát!",
    "💼 Nem szerencsejátékosok vagyunk. Mi 'Vagyon-Átcsoportosító Szakemberek' vagyunk.",
    "🦊 A Róka nem alszik. A Róka figyeli az oddsokat, amíg te pihensz.",
    "🥂 Bontsd a pezsgőt, Főnök! A mai elemzés tűzforró lett! 🔥",
    "🥊 Balhorog a bukinak, jobbegyenes a profitnak. K.O.!",
    "👑 Ne elégedj meg az apróval. Te a Falka tagja vagy. Neked a trón jár!"
];

// --- MODELLEK ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date }, isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.models.Tip || mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String, profitPercent: { type: Number, default: 0 }, 
    matchTime: String, matchDate: String, bookmaker: String, recommendedStake: { type: String, default: "3%" },
    status: { type: String, default: 'pending' }, isPublished: { type: Boolean, default: false },
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
const getDbDate = () => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
};

async function logToChat(sender, message) {
    const timeStr = new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });
    await new ChatMessage({ sender, text: `[${timeStr}] ${message}` }).save();
}

mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 System Ready`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- RÓKA ELEMZÉS (HIBAKERESŐVEL) ---
async function runAiRobot() {
    await ChatMessage.deleteMany({});
    const targetDate = getDbDate();
    
    const key = (process.env.SPORT_API_KEY || "").trim();
    const keyDisplay = key ? `${key.substring(0, 5)}***` : "HIÁNYZIK!";
    await logToChat('System', `🛠️ Vizsgálat: API Kulcs (${keyDisplay}) | Dátum: ${targetDate}`);

    try {
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${targetDate}`, {
            headers: { 
                'x-apisports-key': key, 
                'x-apisports-host': 'v3.football.api-sports.io' 
            },
            timeout: 10000
        });

        if (response.data.errors && Object.keys(response.data.errors).length > 0) {
            await logToChat('System', `❌ API HIBA: ${JSON.stringify(response.data.errors)}`);
            return false;
        }

        let fixtures = response.data.response || [];
        await logToChat('System', `📡 API válasz: ${fixtures.length} meccs érkezett.`);

        let validFixtures = fixtures.filter(f => {
            const matchDate = new Date(f.fixture.date);
            const hunHour = parseInt(matchDate.toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', hour12: false }));
            return hunHour >= 13 && hunHour <= 23;
        });

        if (validFixtures.length === 0) {
            await logToChat('Róka', `⚠️ Ma már nincs 13:00 utáni meccs a kínálatban.`);
            return false;
        }

        const matchData = validFixtures.slice(0, 40).map(f => {
            const time = new Date(f.fixture.date).toLocaleTimeString('hu-HU', {timeZone:'Europe/Budapest', hour:'2-digit', minute:'2-digit'});
            return `[ID:${f.fixture.id}] ${time} - ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`;
        }).join("\n");

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Válaszd ki a legbiztosabb meccset a havi profit maximalizálása érdekében." }, { role: "user", content: `Kínálat:\n${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);

        await Tip.findOneAndUpdate({ date: targetDate }, { 
            ...result, date: targetDate, isPublished: false, isReal: true 
        }, { upsert: true });

        await logToChat('Róka', `✅ ELEMZÉS KÉSZ: ${result.match} kiválasztva.`);
        return true;

    } catch (e) {
        await logToChat('System', `⚠️ HIBA: Az API nem válaszol. Ellenőrizd a kulcsot a Railway-en! (${e.message})`);
        return false;
    }
}

// --- ADMIN ÉS ALAP ÚTVONALAK ---
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'v29_secret_fix', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(50);
    res.render('admin', { users, currentTip, chatHistory, dbDate: getDbDate(), brandName: BRAND_NAME, recentTips: [], stats: [], calculatorData: [] });
});

// GOMBOK (EREDETI ÚTVONALAK)
app.post('/admin/run-robot', checkAdmin, async (req, res) => { await runAiRobot(); res.redirect('/admin'); });
app.post('/admin/delete-today', checkAdmin, async (req, res) => { await Tip.findOneAndDelete({ date: getDbDate() }); res.redirect('/admin'); });
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });

// DASHBOARD ÉS BELÉPÉS
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    res.render('dashboard', { user, dailyTip, recommendedStake: 1000, displayDate: new Date().toLocaleDateString('hu-HU'), foxQuotes, streak: 0 });
});

app.post('/auth/login', async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase() });
    if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); }
    else res.send("Hiba");
});

app.get('/login', (req, res) => res.render('login'));
app.get('/', (req, res) => res.render('index'));
app.listen(process.env.PORT || 8080);