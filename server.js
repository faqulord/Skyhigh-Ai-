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
const BRAND_NAME = "Rafinált Róka"; 

const foxQuotes = [
    "A bank nem ad, a banktól elvesszük. 🦊💰",
    "Ma este símaszkban megyünk a lottózóba. 🏦",
    "A fogadóiroda hibázott. Mi büntetünk. ⚖️",
    "Hideg fej, arany zsákmány. Ez a Falka törvénye. 🔥"
];

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER || OWNER_EMAIL, pass: process.env.EMAIL_PASS }
});

// --- ELŐRE HOZOTT MODELLEK ---

const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String,
    profitPercent: { type: Number, default: 0 }, matchTime: String, matchDate: String, bookmaker: String,
    recommendedStake: { type: String, default: "3%" },
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true },
    isReal: { type: Boolean, default: false }
}));

const MonthlyStat = mongoose.model('MonthlyStat', new mongoose.Schema({
    month: String, totalProfit: { type: Number, default: 0 }, winCount: { type: Number, default: 0 }, 
    lossCount: { type: Number, default: 0 }, totalTips: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: false }
}));

const ChatMessage = mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

// --- FÜGGVÉNYEK ---

async function calculateStreak() {
    try {
        const tips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(10);
        let streak = 0;
        for (let tip of tips) { if (tip.status === 'win') streak++; else break; }
        return streak;
    } catch (e) { return 0; }
}

async function logToChat(sender, message) {
    const now = new Date();
    const timeStr = now.toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const formattedMsg = `[${timeStr}] ${message}`;
    await new ChatMessage({ sender, text: formattedMsg }).save();
}

async function analyzePerformance() {
    const m = new Date().toLocaleDateString('en-CA').substring(0, 7);
    const stat = await MonthlyStat.findOne({ month: m }) || { totalProfit: 0, winCount: 0, totalTips: 0 };
    const lastTips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(5);
    let recentForm = lastTips.map(t => t.status === 'win' ? 'W' : 'L').join('-');
    return { profit: stat.totalProfit, tips: stat.totalTips, form: recentForm || "Nincs adat", winRate: stat.totalTips > 0 ? Math.round((stat.winCount / stat.totalTips) * 100) : 0 };
}

// --- CSATLAKOZÁS ---
mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log(`🚀 ${BRAND_NAME} System Ready - GOLDEN HEIST v21`))
    .catch(err => console.error("MongoDB Hiba:", err));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_boss_system_secret_v21_gold',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getDbDate = () => new Date().toLocaleDateString('en-CA'); 

// --- AI MOTOR (BANKARABLÓ MÓD) ---
async function runAiRobot() {
    await ChatMessage.deleteMany({}); // Tiszta lap
    
    const targetDate = getDbDate();
    const stats = await analyzePerformance();
    
    // Stratégia
    let strategyMode = "NORMAL";
    let stakeAdvice = "3%";
    if (stats.profit >= 30) { strategyMode = "DEFENSIVE"; stakeAdvice = "1-2%"; }
    else if (stats.profit < -10) { strategyMode = "RECOVERY"; stakeAdvice = "2%"; }
    else if (stats.form.startsWith('W-W')) { strategyMode = "AGGRESSIVE"; stakeAdvice = "5%"; }

    await logToChat('Róka', `📊 **STRATÉGIAI JELENTÉS**\nProfit: ${stats.profit}% | Cél: 40%\nMód: ${strategyMode} | Tét: ${stakeAdvice}`);

    let isRealData = false;
    let statusLog = "";
    
    try {
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${targetDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY, 'x-apisports-host': 'v3.football.api-sports.io' },
            httpsAgent: httpsAgent
        });

        if (response.data.errors && Object.keys(response.data.errors).length > 0) {
            if (JSON.stringify(response.data.errors).includes("suspended")) {
                await logToChat('System', `⛔ API KULCS HIBA!`); return false;
            }
        }

        let fixtures = response.data.response || [];
        const now = new Date();
        const threeHoursLater = new Date(now.getTime() + (3 * 60 * 60 * 1000)); 
        let validFixtures = [];

        if (fixtures.length > 0) {
            // IDŐSZŰRÉS: 3 ÓRA + 16:00 UTÁNI KEZDÉS
            validFixtures = fixtures.filter(f => {
                const matchDate = new Date(f.fixture.date);
                const isSafeBuffer = matchDate > threeHoursLater;
                const hunTimeStr = matchDate.toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', hour12: false });
                const hunHour = parseInt(hunTimeStr.split(':')[0]); 
                const isAfternoon = hunHour >= 16; 
                return isSafeBuffer && isAfternoon;
            });
        }

        if (validFixtures.length > 0) {
            isRealData = true;
            statusLog = "✅ ADATFORRÁS: VALÓS API (16:00 UTÁNI MECCSEK).";
        } else {
            isRealData = false;
            statusLog = "⚠️ DEMÓ MÓD (Nincs meccs 16:00 után a pufferzónában).";
            validFixtures = [{
                fixture: { date: targetDate + "T21:00:00", id: 999 }, league: { name: "Bajnokok Ligája (SZIMULÁCIÓ)" }, teams: { home: { name: "Liverpool" }, away: { name: "Real Madrid" } }
            }];
        }

        const matchData = validFixtures.slice(0, 40).map(f => {
            const dateObj = new Date(f.fixture.date);
            const timeStr = dateObj.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Budapest' });
            return `[${timeStr}] ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`;
        }).join("\n");

        // --- 1. PROFI MATEMATIKUS (NEKED) ---
        // Ez marad szigorú, hogy jó döntést hozzon!
        const analysisPrompt = `
            SZEREP: Profi Sportfogadó Stratéga.
            NYELV: KIZÁRÓLAG MAGYARUL VÁLASZOLJ!
            ADAT: ${isRealData ? "VALÓS" : "SZIMULÁCIÓ"}
            MÓD: ${strategyMode} (Tét: ${stakeAdvice})
            
            FELADAT: Válassz meccset a listából (ami már eleve 16:00 utáni).
            MINIMUM ODDS: 1.50 (Ha kisebb, keress duplát!)
            
            KÖTELEZŐ FORMAT (JSON):
            { "league": "...", "match": "Hazai - Vendég", "prediction": "Tipp", "odds": "1.XX", "reasoning": "Jelentem Főnök! [MATEMATIKAI ELEMZÉS]...", "profitPercent": 5, "matchTime": "ÓÓ:PP", "matchDate": "ÉÉÉÉ.HH.NN", "bookmaker": "...", "stake": "${stakeAdvice}" }
        `;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: analysisPrompt }, { role: "user", content: `Kínálat:\n${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        
        // --- 2. BANKRABLÓ RÓKA (TAGOKNAK) ---
        // Ez lesz a vicces, zsivány szöveg!
        const marketingPrompt = `
            Eredeti elemzés: "${result.reasoning}"
            Meccs: ${result.match}
            Tét: ${result.stake}
            Dátum: ${result.matchDate}
            Idő: ${result.matchTime}
            Odds: ${result.odds}
            
            FELADAT: Írd át ezt a szöveget a Tagoknak (A Falkának).
            KARAKTER: Te vagy a "Zsivány Róka", aki épp bankot rabol (a fogadóirodát fosztja ki).
            STÍLUS: 
            - Használj ilyen szavakat: "Lottózó", "Készpénzfelvétel", "Símaszkot fel", "Kiraboljuk őket", "Ez ajándék pénz".
            - Legyél nagyon magabiztos és vicces.
            - DE az adatok (Dátum, Idő, Tét) legyenek halálosan pontosak!
            
            KÖTELEZŐ ELEMEK:
            1. "📅 Dátum: ${result.matchDate}"
            2. "⏰ Kezdés: ${result.matchTime}"
            3. "💰 Tét: ${result.stake}"
        `;
        
        const marketingRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Creative Copywriter." }, { role: "user", content: marketingPrompt }] 
        });

        await Tip.findOneAndUpdate({ date: getDbDate() }, { 
            ...result, 
            memberMessage: marketingRes.choices[0].message.content,
            recommendedStake: result.stake, 
            date: getDbDate(), 
            status: 'pending', 
            isPublished: false,
            isReal: isRealData
        }, { upsert: true });

        await logToChat('Róka', `${statusLog}\n\n✅ **ZSÁKMÁNY KIVÁLASZTVA**\n\n🎯 ${result.match}\n⏰ ${result.matchDate} ${result.matchTime}\n📊 ${result.prediction} (@${result.odds})\n💰 ${result.stake}\n\nA "rablási terv" a Vezérlőpulton van.`);
        return true;

    } catch (e) {
        console.error("HIBA:", e);
        await logToChat('System', `⚠️ Hiba: ${e.message}`);
        return false;
    }
}

// --- ÚTVONALAK ---
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user.email === OWNER_EMAIL) { user.isAdmin = true; user.hasLicense = true; await user.save(); }
    if (!user.hasLicense) return res.redirect('/pricing');
    if (user.startingCapital === 0) return res.render('set-capital', { user });

    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const recommendedStake = Math.floor(user.startingCapital * 0.10);
    const streak = await calculateStreak();
    
    res.render('dashboard', { user, dailyTip, recommendedStake, displayDate: new Date().toLocaleDateString('hu-HU'), randomQuote: "A Róka este vadászik. 🦊🌙", streak });
});

app.get('/stats', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    try {
        const monthlyStats = await MonthlyStat.find({ isPublished: true }).sort({ month: -1 }) || [];
        const historyTips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(30) || [];
        res.render('stats', { user, monthlyStats, historyTips, randomQuote: "Statisztika" });
    } catch (e) { res.render('stats', { user, monthlyStats: [], historyTips: [], randomQuote: "Hiba" }); }
});

app.get('/pricing', (req, res) => res.render('pricing'));
app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(50);
    res.render('admin', { users, currentTip, recentTips: [], stats: [], chatHistory, calculatorData: [], dbDate: getDbDate(), brandName: BRAND_NAME });
});

app.post('/admin/publish-tip', checkAdmin, async (req, res) => {
    await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true });
    res.redirect('/admin');
});
app.post('/admin/delete-today', checkAdmin, async (req, res) => { await Tip.findOneAndDelete({ date: getDbDate() }); res.redirect('/admin'); });
app.post('/admin/run-robot', checkAdmin, async (req, res) => { req.setTimeout(300000); await runAiRobot(); res.redirect('/admin'); });
app.post('/admin/chat', checkAdmin, async (req, res) => { await logToChat('Főnök', req.body.message); const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Róka (Magyarul)." }, { role: "user", content: req.body.message }] }); await logToChat('Róka', aiRes.choices[0].message.content); res.json({ reply: aiRes.choices[0].message.content }); });

// AUTH & EGYÉB
app.post('/auth/register', async (req, res) => { if(!req.body.terms)return res.send("Hiba"); const h=await bcrypt.hash(req.body.password,10); try{const u=await new User({fullname:req.body.fullname,email:req.body.email.toLowerCase(),password:h}).save();req.session.userId=u._id;res.redirect('/pricing');}catch(e){res.send("Email foglalt");} });
app.post('/auth/login', async (req, res) => { const u=await User.findOne({email:req.body.email.toLowerCase()}); if(u&&await bcrypt.compare(req.body.password,u.password)){req.session.userId=u._id;res.redirect('/dashboard');}else res.send("Hiba"); });
app.post('/user/set-capital', async (req, res) => { await User.findByIdAndUpdate(req.session.userId, {startingCapital:req.body.capital}); res.redirect('/dashboard'); });
app.get('/terms', (req, res) => res.render('terms')); app.get('/login', (req, res) => res.render('login')); app.get('/register', (req, res) => res.render('register')); app.get('/', (req, res) => res.render('index')); app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.listen(process.env.PORT || 8080);