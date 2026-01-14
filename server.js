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
    "A tőzsde évi 10%-ot hoz. Mi ezt egy hétvégén megcsináljuk. Csak ésszel. 🦊📈",
    "Az érzelmek a szegények luxusa. Mi algoritussal dolgozunk. 🤖💸",
    "Ne a csapatnak szurkolj. A profitnak szurkolj. ⚽💰",
    "A fogadóiroda algoritmusokat használ ellened. Most te is használsz egyet ellenük. ⚔️",
    "A szerencse forgandó, a statisztika állandó. Maradj a tervnél. 📉",
    "Hideg fej, forró szelvény. Ez a recept. ❄️🔥"
];

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER || OWNER_EMAIL, pass: process.env.EMAIL_PASS }
});

mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log(`🚀 ${BRAND_NAME} System Ready - FREE API PATCH`))
    .catch(err => console.error("MongoDB Hiba:", err));

// MODELLEK
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String,
    profitPercent: { type: Number, default: 0 }, matchTime: String, bookmaker: String,
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }
}));

const MonthlyStat = mongoose.model('MonthlyStat', new mongoose.Schema({
    month: String, totalProfit: { type: Number, default: 0 }, winCount: { type: Number, default: 0 }, totalTips: { type: Number, default: 0 },
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
    secret: 'skyhigh_boss_system_secret_v800',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Ez csak a belső adatbázis azonosítóhoz kell
const getDbDate = () => new Date().toLocaleDateString('en-CA'); 

// --- SEGÉDFÜGGVÉNY: VALÓS VILÁGIDŐ LEKÉRÉSE ---
async function getRealWorldDate() {
    try {
        // Lekérjük a pontos időt egy külső szerverről (Budapest)
        const res = await axios.get('https://timeapi.io/api/Time/current/zone?timeZone=Europe/Budapest');
        // Formátum: YYYY-MM-DD
        const year = res.data.year;
        const month = String(res.data.month).padStart(2, '0');
        const day = String(res.data.day).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (error) {
        console.error("Idő lekérés hiba:", error);
        // Ha nem sikerül, visszaállunk a rendszeridőre (vészhelyzet)
        return new Date().toLocaleDateString('en-CA');
    }
}

// --- SEGÉDFÜGGVÉNY: NYERŐ SZÉRIA ---
async function calculateStreak() {
    const tips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(10);
    let streak = 0;
    for (let tip of tips) { if (tip.status === 'win') streak++; else break; }
    return streak;
}

// --- AI MOTOR (INGYENES API KOMPATIBILIS) ---
async function runAiRobot() {
    console.log("🦊 AI MOTOR INDÍTÁSA...");
    try {
        // 1. LÉPÉS: MEGTUDJUK A VALÓS DÁTUMOT (Függetlenül a 2026-os szervertől)
        const realDate = await getRealWorldDate();
        console.log(`📅 Valós Világidő: ${realDate}`);
        
        let matchData = "";
        let isEmergencyMode = false;

        // 2. LÉPÉS: MECCSEK LEKÉRÉSE A VALÓS DÁTUMRA
        // Most már ?date=... formátumot használunk, amit az ingyenes API is elfogad!
        try {
            const httpsAgent = new https.Agent({ rejectUnauthorized: false });
            const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${realDate}`, {
                headers: { 'x-apisports-key': process.env.SPORT_API_KEY },
                httpsAgent: httpsAgent
            });

            if (response.data.errors && Object.keys(response.data.errors).length > 0) {
                const errJson = JSON.stringify(response.data.errors);
                await new ChatMessage({ sender: 'System', text: `⚠️ API HIBA: ${errJson}` }).save();
                throw new Error("API Hiba");
            }

            // Szűrés: Csak azok a meccsek, amik még hátravannak (vagy épp most kezdődtek)
            // Itt a szerver 2026-os ideje miatt trükközni kell: Minden meccset elfogadunk, ami "NS" (Not Started) vagy "1H" (1. félidő) státuszú.
            const allFixtures = response.data.response || [];
            const activeFixtures = allFixtures.filter(f => ['NS', '1H', 'HT'].includes(f.fixture.status.short));

            if (activeFixtures.length > 0) {
                console.log(`⚽ Talált meccsek száma: ${activeFixtures.length}`);
                
                // Top 40 meccs kiválasztása, priorizálva a nagyobb ligákat (ID alapján)
                matchData = activeFixtures.slice(0, 40).map(f => {
                    const time = f.fixture.date.split('T')[1].substring(0, 5); // Csak az óra:perc
                    return `[${time}] ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name}) - Odds nem elérhető, becsülj!`;
                }).join("\n");
            } else {
                throw new Error("Nincs már hátra lévő meccs mára a listában.");
            }

        } catch (apiError) {
            console.log("❌ API HIBA -> OFFLINE MÓD");
            isEmergencyMode = true;
            await new ChatMessage({ sender: 'System', text: `⚠️ Nem sikerült meccset letölteni (${apiError.message}). Vésztartalék aktiválva, hogy lásd a működést!` }).save();
            
            // Vésztartalék (Hogy ne legyen üres a rendszer)
            matchData = `
                [20:45] Manchester City vs Real Madrid (Bajnokok Ligája)
                [18:30] Arsenal vs Liverpool (Premier League)
                [21:00] Barcelona vs Atletico Madrid (La Liga)
            `;
        }

        // 3. AI DÖNTÉS
        const streak = await calculateStreak();
        let memoryContext = streak > 0 ? `Jelenleg ${streak} napos NYERŐ SZÉRIÁBAN vagyunk!` : "Tegnap vesztettünk, ma javítunk.";

        const systemPrompt = `
            IDENTITY: Te vagy a "Rafinált Róka" AI Sportfogadó Algoritmus.
            FELADAT: Válassz ki EGYETLEN meccset a listából (Value Bet).
            MODE: ${isEmergencyMode ? "OFFLINE / DEMO" : "ÉLES"}
            CONTEXT: ${memoryContext}
            STÍLUS: Szakmai, tömör, elemző jelentés a Tulajdonosnak.
            FORMAT: JSON.
            JSON STRUCTURE: { "league": "...", "match": "Hazai vs Vendég", "prediction": "...", "odds": "1.XX", "reasoning": "Főnök! Az elemzés alapján...", "profitPercent": 5, "matchTime": "HH:MM", "bookmaker": "..." }
        `;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Kínálat:\n${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        
        // MENTÉS (A getDbDate() miatt a "mai" 2026-os helyre menti, hogy lásd az adminban)
        await Tip.findOneAndUpdate({ date: getDbDate() }, { 
            ...result, 
            date: getDbDate(), 
            status: 'pending', 
            isPublished: false, 
            memberMessage: "" 
        }, { upsert: true });

        return true;

    } catch (e) { 
        console.error("AI HIBA:", e); 
        await new ChatMessage({ sender: 'System', text: `⚠️ KRITIKUS HIBA: ${e.message}` }).save();
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
    const tip = await Tip.findById(tipId);
    
    const transformPrompt = `
        Forrás: "${tip.reasoning}"
        FELADAT: Írd át ezt a tagoknak.
        STÍLUS: Zsivány Róka. Laza, dörzsölt, tele emojikkal (🦊, 💸).
        TILOS: Ne használd a "Főnök" szót.
    `;
    const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Marketing." }, { role: "user", content: transformPrompt }] });
    await Tip.findByIdAndUpdate(tipId, { isPublished: true, memberMessage: aiRes.choices[0].message.content });
    await new ChatMessage({ sender: 'System', text: '✅ Tipp publikálva!' }).save();
    res.redirect('/admin');
});

app.post('/admin/delete-today', checkAdmin, async (req, res) => {
    await Tip.findOneAndDelete({ date: getDbDate() });
    await new ChatMessage({ sender: 'System', text: '🗑️ Tipp törölve.' }).save();
    res.redirect('/admin');
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => { 
    req.setTimeout(300000); 
    const success = await runAiRobot(); 
    if(success) await new ChatMessage({ sender: 'AI', text: '🧠 Kész az elemzés! Nézd meg a Vezérlőpultot.' }).save();
    res.redirect('/admin'); 
});

app.post('/admin/social-content', checkAdmin, async (req, res) => {
    const { type } = req.body; 
    let context = type === 'win' ? "Téma: NYERTÜNK!" : "Téma: MOTIVÁCIÓ.";
    const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Social Media Expert." }, { role: "user", content: `Írj Insta posztot. ${context}` }] });
    res.json({ content: aiRes.choices[0].message.content });
});

app.post('/admin/chat', checkAdmin, async (req, res) => { await new ChatMessage({ sender: 'Főnök', text: req.body.message }).save(); const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Te vagy a Rafinált Róka." }, { role: "user", content: req.body.message }] }); await new ChatMessage({ sender: 'AI', text: aiRes.choices[0].message.content }).save(); res.json({ reply: aiRes.choices[0].message.content }); });
app.post('/admin/draft-email', checkAdmin, async (req, res) => { const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Marketing Expert." }, { role: "user", content: `Írj hírlevél vázlatot: ${req.body.topic}` }] }); res.json({ draft: aiRes.choices[0].message.content }); });
app.post('/admin/send-test-email', checkAdmin, async (req, res) => { try { await transporter.sendMail({ from: `"${BRAND_NAME}" <${process.env.EMAIL_USER || OWNER_EMAIL}>`, to: OWNER_EMAIL, subject: `[TESZT] ${req.body.subject}`, text: req.body.messageBody }); res.redirect('/admin'); } catch(e){console.error(e);res.redirect('/admin');} });
app.post('/admin/send-email', checkAdmin, async (req, res) => { try { const u = await User.find({hasLicense:true}); if(u.length>0) await transporter.sendMail({ from: `"${BRAND_NAME}" <${process.env.EMAIL_USER || OWNER_EMAIL}>`, to: OWNER_EMAIL, bcc: u.map(x=>x.email), subject: req.body.subject, text: req.body.messageBody }); res.redirect('/admin'); } catch(e){console.error(e);res.redirect('/admin');} });
app.post('/admin/publish-stat', checkAdmin, async (req, res) => { await MonthlyStat.findByIdAndUpdate(req.body.statId, { isPublished: true }); res.redirect('/admin'); });
app.post('/admin/settle-tip', checkAdmin, async (req, res) => { const t = await Tip.findById(req.body.tipId); if(t.status!==req.body.status){ t.status=req.body.status; await t.save(); const m = t.date.substring(0,7); let s = await MonthlyStat.findOne({month:m})||new MonthlyStat({month:m}); s.totalTips++; if(req.body.status==='win'){s.winCount++; s.totalProfit+=t.profitPercent;} else {s.totalProfit-=10;} await s.save(); } res.redirect('/admin'); });
app.post('/admin/activate-user', checkAdmin, async (req, res) => { await User.findByIdAndUpdate(req.body.userId, { hasLicense: true }); res.redirect('/admin'); });
app.post('/auth/register', async (req, res) => { if(!req.body.terms)return res.send("Hiba!"); const h = await bcrypt.hash(req.body.password,10); try{const u = await new User({fullname:req.body.fullname,email:req.body.email.toLowerCase(),password:h}).save(); req.session.userId=u._id; res.redirect('/pricing');}catch(e){res.send("Email foglalt!");} });
app.post('/auth/login', async (req, res) => { const u = await User.findOne({email:req.body.email.toLowerCase()}); if(u && await bcrypt.compare(req.body.password,u.password)){req.session.userId=u._id; req.session.save(()=>res.redirect('/dashboard'));}else res.send("Hiba!"); });
app.post('/user/set-capital', async (req, res) => { await User.findByIdAndUpdate(req.session.userId, {startingCapital:req.body.capital}); res.redirect('/dashboard'); });
app.get('/terms', (req, res) => res.render('terms')); app.get('/login', (req, res) => res.render('login')); app.get('/register', (req, res) => res.render('register')); app.get('/', (req, res) => res.render('index')); app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.listen(process.env.PORT || 8080);