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
    "A profitot nem a szerencse hozza, hanem a fegyelem. 🧠",
    "Tétkezelés nélkül a legjobb tipp is semmit ér. ⚖️",
    "A cél 40%. Minden lépésünket ez vezérli. 🎯",
    "Hideg fej, forró oddsok, pontos tét. Ez a recept. 🔥"
];

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER || OWNER_EMAIL, pass: process.env.EMAIL_PASS }
});

// --- MODELLEK DEFINIÁLÁSA (ELŐRE HOZVA) ---
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

// --- SEGÉDFÜGGVÉNYEK (FONTOS: ITT KELL LENNIÜK ELÖL!) ---

// 1. Nyerő Széria Számítás
async function calculateStreak() {
    try {
        const tips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(10);
        let streak = 0;
        for (let tip of tips) { if (tip.status === 'win') streak++; else break; }
        return streak;
    } catch (error) {
        console.error("Streak hiba:", error);
        return 0; // Hiba esetén 0-t ad vissza, nem omlik össze
    }
}

// 2. Chat Logolás
async function logToChat(sender, message) {
    const now = new Date();
    const timeStr = now.toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const formattedMsg = `[${timeStr}] ${message}`;
    await new ChatMessage({ sender, text: formattedMsg }).save();
}

// 3. Teljesítmény Elemző
async function analyzePerformance() {
    const m = new Date().toLocaleDateString('en-CA').substring(0, 7);
    const stat = await MonthlyStat.findOne({ month: m }) || { totalProfit: 0, winCount: 0, totalTips: 0 };
    const lastTips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(5);
    let recentForm = lastTips.map(t => t.status === 'win' ? 'W' : 'L').join('-');
    
    return {
        profit: stat.totalProfit,
        tips: stat.totalTips,
        form: recentForm || "Nincs adat",
        winRate: stat.totalTips > 0 ? Math.round((stat.winCount / stat.totalTips) * 100) : 0
    };
}

// --- ADATBÁZIS KAPCSOLÓDÁS ---
mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log(`🚀 ${BRAND_NAME} System Ready - FIXED V18.1`))
    .catch(err => console.error("MongoDB Hiba:", err));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_boss_system_secret_v18_fix',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getDbDate = () => new Date().toLocaleDateString('en-CA'); 

// --- AI MOTOR (STRATEGIST) ---
async function runAiRobot() {
    await ChatMessage.deleteMany({});
    
    const targetDate = getDbDate();
    const stats = await analyzePerformance();
    
    let strategyMode = "NORMAL";
    let stakeAdvice = "3%";
    let strategyReason = "";

    if (stats.profit >= 30) {
        strategyMode = "DEFENSIVE";
        stakeAdvice = "1-2%";
        strategyReason = "Cél (30%) elérve! Mostantól PROFITVÉDELEM. Csak biztosra megyünk, kis téttel.";
    } else if (stats.profit < -10) {
        strategyMode = "RECOVERY";
        stakeAdvice = "2%";
        strategyReason = "Mínuszban vagyunk. Óvatos visszaépítés (Recovery Mode). Nem kapkodunk.";
    } else if (stats.form.startsWith('W-W')) {
        strategyMode = "AGGRESSIVE";
        stakeAdvice = "5%";
        strategyReason = "Elkaptuk a fonalat (Winning Streak)! Növeljük a tétet a 40%-os cél eléréséhez.";
    } else {
        strategyMode = "BALANCED";
        stakeAdvice = "3-4%";
        strategyReason = "Kiegyensúlyozott építkezés. A cél a stabil növekedés.";
    }

    await logToChat('Róka', `📊 **NAPI STRATÉGIAI JELENTÉS**\n\n💰 Havi Profit: ${stats.profit}%\n📈 Cél: 30-40%\n🔥 Forma: ${stats.form}\n\n🧠 **MAI TAKTIKA:** ${strategyMode}\n💡 ${strategyReason}\n⚖️ Javasolt Tét: ${stakeAdvice}`);

    console.log(`🦊 AI MOTOR: ${strategyMode} módban elemzés indul: ${targetDate}`);
    
    let isRealData = false;
    let statusLog = "";
    
    try {
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });

        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${targetDate}`, {
            headers: { 
                'x-apisports-key': process.env.SPORT_API_KEY,
                'x-apisports-host': 'v3.football.api-sports.io'
            },
            httpsAgent: httpsAgent
        });

        if (response.data.errors && Object.keys(response.data.errors).length > 0) {
            const errStr = JSON.stringify(response.data.errors);
            if (errStr.includes("suspended")) {
                await logToChat('System', `⛔ KRITIKUS: API KULCS HIBA!`);
                return false;
            }
        }

        let fixtures = response.data.response || [];
        const now = new Date();
        const threeHoursLater = new Date(now.getTime() + (3 * 60 * 60 * 1000)); 
        let validFixtures = [];

        if (fixtures.length > 0) {
            validFixtures = fixtures.filter(f => new Date(f.fixture.date) > threeHoursLater);
        }

        if (validFixtures.length > 0) {
            isRealData = true;
            statusLog = "✅ ADATFORRÁS: VALÓS API.";
        } else {
            isRealData = false;
            statusLog = "⚠️ DEMÓ MÓD (Nincs megfelelő meccs).";
            validFixtures = [{
                fixture: { date: targetDate + "T21:00:00", id: 999, status: { short: 'NS' } },
                league: { name: "Bajnokok Ligája (SZIMULÁCIÓ)" },
                teams: { home: { name: "Liverpool" }, away: { name: "Real Madrid" } }
            }];
        }

        const matchData = validFixtures.slice(0, 40).map(f => {
            const dateObj = new Date(f.fixture.date);
            const timeStr = dateObj.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Budapest' });
            return `[${timeStr}] ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`;
        }).join("\n");

        const analysisPrompt = `
            SZEREP: Profi Sportfogadó Stratéga.
            ADAT: ${isRealData ? "VALÓS" : "SZIMULÁCIÓ"}
            STRATÉGIA MÓD: ${strategyMode}
            JAVASOLT TÉT: ${stakeAdvice}
            FELADAT: Válassz ki egy meccset (vagy duplát). MINIMUM ODDS: 1.50
            FORMAT: JSON.
            JSON: { "league": "...", "match": "Hazai - Vendég", "prediction": "Tipp", "odds": "1.XX", "reasoning": "...", "profitPercent": 5, "matchTime": "HH:MM", "matchDate": "YYYY.MM.DD", "bookmaker": "...", "stake": "${stakeAdvice}" }
        `;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: analysisPrompt }, { role: "user", content: `Kínálat:\n${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        
        const marketingPrompt = `
            Eredeti elemzés: "${result.reasoning}"
            Meccs: ${result.match}
            Tipp: ${result.prediction}
            Odds: ${result.odds}
            Tét: ${result.stake}
            
            FELADAT: Írd át a tagoknak. KARAKTER: Rafinált Róka.
            FONTOS: Emeld ki a TÉTET és az IDŐPONTOT.
        `;
        
        const marketingRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Marketing." }, { role: "user", content: marketingPrompt }] 
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

        await logToChat('Róka', `${statusLog}\n\n✅ **TIPP KIVÁLASZTVA**\n\n🎯 Meccs: ${result.match}\n⏰ Kezdés: ${result.matchTime}\n📊 Tipp: ${result.prediction} (@${result.odds})\n💰 Tét: ${result.stake}\n\nRészletek a Vezérlőpulton.`);
        return true;

    } catch (e) {
        console.error("RENDSZER HIBA:", e);
        await logToChat('System', `⚠️ Hiba: ${e.message}`);
        return false;
    }
}

const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- ÚTVONALAK ---

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user.email === OWNER_EMAIL) { user.isAdmin = true; user.hasLicense = true; await user.save(); }
    if (!user.hasLicense) return res.redirect('/pricing');
    if (user.startingCapital === 0) return res.render('set-capital', { user });

    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const recommendedStake = Math.floor(user.startingCapital * 0.10); 
    const randomQuote = foxQuotes[Math.floor(Math.random() * foxQuotes.length)];
    // ITT VOLT A HIBA - MOST MÁR MŰKÖDNI FOG:
    const streak = await calculateStreak();
    
    res.render('dashboard', { user, dailyTip, recommendedStake, displayDate: new Date().toLocaleDateString('hu-HU'), randomQuote, streak });
});

app.get('/stats', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user.hasLicense) return res.redirect('/pricing');
    try {
        const monthlyStats = await MonthlyStat.find({ isPublished: true }).sort({ month: -1 }) || [];
        const historyTips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(30) || [];
        res.render('stats', { user, monthlyStats, historyTips, randomQuote: "A számok nem hazudnak." });
    } catch (e) { res.render('stats', { user, monthlyStats: [], historyTips: [], randomQuote: "Adatbázis hiba." }); }
});

app.get('/pricing', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    res.render('pricing', { user });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const recentTips = await Tip.find().sort({ date: -1 }).limit(5);
    const stats = await MonthlyStat.find().sort({ month: -1 });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(50);
    const currentMonthPrefix = getDbDate().substring(0, 7);
    const monthlyTips = await Tip.find({ date: { $regex: new RegExp('^' + currentMonthPrefix) } }).sort({ date: 1 });
    let runningProfit = 0;
    const calculatorData = monthlyTips.map(t => {
        let dailyRes = (t.status === 'win') ? parseFloat(t.profitPercent) : (t.status === 'loss' ? -10 : 0);
        runningProfit += dailyRes;
        return { date: t.date, match: t.match, status: t.status, dailyProfit: dailyRes, totalRunning: runningProfit };
    });
    res.render('admin', { users, currentTip, recentTips, stats, chatHistory, calculatorData, dbDate: getDbDate(), brandName: BRAND_NAME });
});

app.post('/admin/publish-tip', checkAdmin, async (req, res) => {
    const { tipId } = req.body;
    await Tip.findByIdAndUpdate(tipId, { isPublished: true });
    res.redirect('/admin');
});

app.post('/admin/settle-tip', checkAdmin, async (req, res) => { 
    const t = await Tip.findById(req.body.tipId); 
    if(t.status !== req.body.status){ 
        t.status = req.body.status; 
        await t.save(); 
        
        const m = t.date.substring(0,7); 
        let s = await MonthlyStat.findOne({month:m}) || new MonthlyStat({month:m}); 
        
        const tipsInMonth = await Tip.find({ date: { $regex: new RegExp('^' + m) } });
        s.totalTips = 0; s.winCount = 0; s.lossCount = 0; s.totalProfit = 0;

        tipsInMonth.forEach(tip => {
            if (tip.status === 'win') {
                s.totalTips++; s.winCount++; s.totalProfit += tip.profitPercent;
            } else if (tip.status === 'loss') {
                s.totalTips++; s.lossCount++; s.totalProfit -= 10;
            }
        });
        await s.save(); 
    } 
    res.redirect('/admin'); 
});

app.post('/admin/delete-today', checkAdmin, async (req, res) => { await Tip.findOneAndDelete({ date: getDbDate() }); res.redirect('/admin'); });
app.post('/admin/run-robot', checkAdmin, async (req, res) => { 
    req.setTimeout(300000); 
    const success = await runAiRobot(); 
    res.redirect('/admin'); 
});
app.post('/admin/social-content', checkAdmin, async (req, res) => { const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Social." }, { role: "user", content: `Írj Insta posztot. Téma: ${req.body.type}` }] }); res.json({ content: aiRes.choices[0].message.content }); });
app.post('/admin/chat', checkAdmin, async (req, res) => { await logToChat('Főnök', req.body.message); const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Stratéga." }, { role: "user", content: req.body.message }] }); await logToChat('Róka', aiRes.choices[0].message.content); res.json({ reply: aiRes.choices[0].message.content }); });
app.post('/admin/draft-email', checkAdmin, async (req, res) => { const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Marketing." }, { role: "user", content: `Téma: ${req.body.topic}` }] }); res.json({ draft: aiRes.choices[0].message.content }); });
app.post('/admin/send-test-email', checkAdmin, async (req, res) => { try { await transporter.sendMail({ from: `"${BRAND_NAME}" <${process.env.EMAIL_USER || OWNER_EMAIL}>`, to: OWNER_EMAIL, subject: `[TESZT] ${req.body.subject}`, text: req.body.messageBody }); res.redirect('/admin'); } catch(e){console.error(e);res.redirect('/admin');} });
app.post('/admin/send-email', checkAdmin, async (req, res) => { try { const u = await User.find({hasLicense:true}); if(u.length>0) await transporter.sendMail({ from: `"${BRAND_NAME}" <${process.env.EMAIL_USER || OWNER_EMAIL}>`, to: OWNER_EMAIL, bcc: u.map(x=>x.email), subject: req.body.subject, text: req.body.messageBody }); res.redirect('/admin'); } catch(e){console.error(e);res.redirect('/admin');} });
app.post('/admin/publish-stat', checkAdmin, async (req, res) => { await MonthlyStat.findByIdAndUpdate(req.body.statId, { isPublished: true }); res.redirect('/admin'); });
app.post('/admin/activate-user', checkAdmin, async (req, res) => { await User.findByIdAndUpdate(req.body.userId, { hasLicense: true }); res.redirect('/admin'); });
app.post('/auth/register', async (req, res) => { if(!req.body.terms)return res.send("Hiba!"); const h = await bcrypt.hash(req.body.password,10); try{const u = await new User({fullname:req.body.fullname,email:req.body.email.toLowerCase(),password:h}).save(); req.session.userId=u._id; res.redirect('/pricing');}catch(e){res.send("Email foglalt!");} });
app.post('/auth/login', async (req, res) => { const u = await User.findOne({email:req.body.email.toLowerCase()}); if(u && await bcrypt.compare(req.body.password,u.password)){req.session.userId=u._id; req.session.save(()=>res.redirect('/dashboard'));}else res.send("Hiba!"); });
app.post('/user/set-capital', async (req, res) => { await User.findByIdAndUpdate(req.session.userId, {startingCapital:req.body.capital}); res.redirect('/dashboard'); });
app.get('/terms', (req, res) => res.render('terms')); app.get('/login', (req, res) => res.render('login')); app.get('/register', (req, res) => res.render('register')); app.get('/', (req, res) => res.render('index')); app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.listen(process.env.PORT || 8080);