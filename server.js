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
    "A matematika nem hazudik. Az érzelmek igen. Mi számolunk. 🧮",
    "A profit a türelem és a statisztika közös gyermeke. 🦊💰",
    "Nem szerencsejátékosok vagyunk, hanem befektetők. 📈",
    "Hideg fej, pontos számok, forró oddsok. 🔥"
];

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER || OWNER_EMAIL, pass: process.env.EMAIL_PASS }
});

mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log(`🚀 ${BRAND_NAME} System Ready - MATHEMATICIAN V16`))
    .catch(err => console.error("MongoDB Hiba:", err));

// --- MODELLEK ---

const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String,
    profitPercent: { type: Number, default: 0 }, matchTime: String, matchDate: String, bookmaker: String,
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }, // Ez a DB azonosító (YYYY-MM-DD)
    isReal: { type: Boolean, default: false }
}));

const MonthlyStat = mongoose.model('MonthlyStat', new mongoose.Schema({
    month: String, // YYYY-MM formátum
    totalProfit: { type: Number, default: 0 }, 
    winCount: { type: Number, default: 0 }, 
    lossCount: { type: Number, default: 0 },
    totalTips: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: false }
}));

const ChatMessage = mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_boss_system_secret_v16_math',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Szerver ideje (2026.01.14)
const getDbDate = () => new Date().toLocaleDateString('en-CA'); 

// --- NYERŐ SZÉRIA SZÁMÍTÁS ---
async function calculateStreak() {
    const tips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(10);
    let streak = 0;
    for (let tip of tips) { if (tip.status === 'win') streak++; else break; }
    return streak;
}

// --- AI MOTOR (MATEMATIKUS RÓKA) ---
async function runAiRobot() {
    // 1. TISZTA LAP (Chat törlése)
    await ChatMessage.deleteMany({});
    
    const targetDate = getDbDate();
    console.log(`🦊 AI MOTOR: Elemzés indítása: ${targetDate}`);
    
    let isRealData = false;
    let statusLog = "";
    
    try {
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });

        // API HÍVÁS
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${targetDate}`, {
            headers: { 
                'x-apisports-key': process.env.SPORT_API_KEY,
                'x-apisports-host': 'v3.football.api-sports.io'
            },
            httpsAgent: httpsAgent
        });

        if (response.data.errors && Object.keys(response.data.errors).length > 0) {
            const errStr = JSON.stringify(response.data.errors);
            console.error("API HIBA:", errStr);
            await new ChatMessage({ sender: 'System', text: `⛔ API HIBA: ${errStr}` }).save();
            return false;
        }

        let fixtures = response.data.response || [];
        
        // IDŐSZŰRÉS (+3 ÓRA PUFFER - BUDAPEST)
        const now = new Date();
        const threeHoursLater = new Date(now.getTime() + (3 * 60 * 60 * 1000)); 
        let validFixtures = [];

        if (fixtures.length > 0) {
            validFixtures = fixtures.filter(f => {
                const matchTime = new Date(f.fixture.date);
                return matchTime > threeHoursLater;
            });
        }

        if (validFixtures.length > 0) {
            isRealData = true;
            statusLog = "✅ ADATFORRÁS ELLENŐRZVE: HITELES, ÉLŐ API ADAT.";
        } else {
            isRealData = false;
            statusLog = "⚠️ FIGYELEM: Nincs fogadható meccs a 3 órás zónán túl (vagy API limit). DEMÓ ADAT generálva.";
            validFixtures = [{
                fixture: { date: targetDate + "T21:00:00", id: 999, status: { short: 'NS' } },
                league: { name: "Bajnokok Ligája (SZIMULÁCIÓ)" },
                teams: { home: { name: "Liverpool" }, away: { name: "Real Madrid" } }
            }];
        }

        // ADATOK ELŐKÉSZÍTÉSE
        const matchData = validFixtures.slice(0, 30).map(f => {
            const dateObj = new Date(f.fixture.date);
            // Budapesti idő konverzió
            const timeStr = dateObj.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Budapest' });
            return `[${targetDate} ${timeStr}] ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`;
        }).join("\n");

        const streak = await calculateStreak();
        let memoryContext = streak > 0 ? `Jelenlegi sorozat: ${streak} NYERTES tipp.` : "Előző tipp: VESZTES. Korrekció szükséges.";

        // --- 1. PROFI MATEMATIKUS ELEMZŐ (NEKED) ---
        const analysisPrompt = `
            SZEREP: Profi Sportfogadó Elemző és Matematikus (AI Sport Betting Assistant).
            ADAT FORRÁSA: ${isRealData ? "VALÓS" : "SZIMULÁCIÓ"}
            FELADAT: Válassz ki EGYETLEN mérkőzést, ahol a legnagyobb a "Value" (Érték).
            STÍLUS: Szigorú, katonás, tényeken alapuló. Mellőzd a felesleges körítést.
            ELVÁRÁS:
            - Elemezd a formát.
            - Írd le pontosan a dátumot és időt (Budapesti idő).
            - Indoklásban hivatkozz statisztikára.
            FORMAT: JSON.
            JSON: { "league": "...", "match": "Hazai - Vendég", "prediction": "...", "odds": "1.XX", "reasoning": "Jelentem Főnök! A [ÉÉÉÉ.HH.NN ÓÓ:PP]-kor kezdődő mérkőzés matematikai elemzése alapján...", "profitPercent": 5, "matchTime": "HH:MM", "matchDate": "YYYY.MM.DD", "bookmaker": "..." }
        `;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: analysisPrompt }, { role: "user", content: `Kínálat:\n${matchData}\n\nKontextus: ${memoryContext}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        
        // --- 2. ZSIVÁNY RÓKA (TAGOKNAK) ---
        const marketingPrompt = `
            Eredeti elemzés: "${result.reasoning}"
            Meccs: ${result.match}
            Időpont: ${result.matchDate} ${result.matchTime}
            
            FELADAT: Írd át ezt a tagoknak.
            KARAKTER: Rafinált Róka (Dörzsölt, profi, de laza).
            STÍLUS: 
            - Használj emojikat (🦊, ⚽, 💸).
            - Emeld ki NAGYON az időpontot: "📅 Dátum: ... ⏰ Kezdés: ..."
            - A "Főnök" szót NE használd.
            - Legyen benne, hogy "A matematika mellettünk áll".
        `;
        
        const marketingRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Marketing." }, { role: "user", content: marketingPrompt }] 
        });

        // MENTÉS
        await Tip.findOneAndUpdate({ date: getDbDate() }, { 
            ...result, 
            memberMessage: marketingRes.choices[0].message.content,
            date: getDbDate(), 
            status: 'pending', 
            isPublished: false,
            isReal: isRealData
        }, { upsert: true });

        // CHAT JELENTÉS
        await new ChatMessage({ 
            sender: 'Róka', 
            text: `${statusLog}\n\n🫡 ELEMZÉS KÉSZ!\n\n🎯 Meccs: ${result.match}\n📅 Dátum: ${result.matchDate}\n⏰ Kezdés: ${result.matchTime}\n📊 Tipp: ${result.prediction}\n\nA teljes jelentés a Vezérlőpulton olvasható.` 
        }).save();

        return true;

    } catch (e) {
        console.error("RENDSZER HIBA:", e);
        await new ChatMessage({ sender: 'System', text: `⚠️ Hiba: ${e.message}` }).save();
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

// --- ADMIN FUNKCIÓK ---

app.post('/admin/publish-tip', checkAdmin, async (req, res) => {
    const { tipId } = req.body;
    await Tip.findByIdAndUpdate(tipId, { isPublished: true });
    res.redirect('/admin');
});

// KIÉRTÉKELÉS (SETTLE) + AUTOMATIKUS STATISZTIKA FRISSÍTÉS
app.post('/admin/settle-tip', checkAdmin, async (req, res) => { 
    const t = await Tip.findById(req.body.tipId); 
    if(t.status !== req.body.status){ 
        t.status = req.body.status; 
        await t.save(); 
        
        // --- STATISZTIKA AUTOMATIZÁLÁS ---
        const m = t.date.substring(0,7); // YYYY-MM
        let s = await MonthlyStat.findOne({month:m}) || new MonthlyStat({month:m}); 
        
        // Újraszámoljuk az egész hónapot a biztonság kedvéért
        const tipsInMonth = await Tip.find({ date: { $regex: new RegExp('^' + m) } });
        s.totalTips = 0; s.winCount = 0; s.lossCount = 0; s.totalProfit = 0;

        tipsInMonth.forEach(tip => {
            if (tip.status === 'win') {
                s.totalTips++;
                s.winCount++;
                s.totalProfit += tip.profitPercent;
            } else if (tip.status === 'loss') {
                s.totalTips++;
                s.lossCount++;
                s.totalProfit -= 10; // Feltételezve 10% tétvesztést
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
app.post('/admin/chat', checkAdmin, async (req, res) => { await new ChatMessage({ sender: 'Főnök', text: req.body.message }).save(); const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Matematikus Elemző." }, { role: "user", content: req.body.message }] }); await new ChatMessage({ sender: 'Róka', text: aiRes.choices[0].message.content }).save(); res.json({ reply: aiRes.choices[0].message.content }); });
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