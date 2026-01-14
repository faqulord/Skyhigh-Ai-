const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const nodemailer = require('nodemailer');
const path = require('path');
const app = express();

const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const BRAND_NAME = "Rafinált Róka"; 

// --- ZSIVÁNY RÓKA MARKETING SZÖVEGEK ---
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
    .then(() => console.log(`🚀 ${BRAND_NAME} System Ready - PROFIT ENGINE V6.0`))
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
    status: { type: String, default: 'pending' }, // pending, win, loss
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
    secret: 'skyhigh_boss_system_secret_v600',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getDbDate = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

// --- SEGÉDFÜGGVÉNY: NYERŐ SZÉRIA SZÁMÍTÁSA ---
async function calculateStreak() {
    const tips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(10);
    let streak = 0;
    for (let tip of tips) {
        if (tip.status === 'win') streak++;
        else break;
    }
    return streak;
}

// --- JAVÍTOTT AI MOTOR ---
async function runAiRobot() {
    console.log("🦊 AI MOTOR INDÍTÁSA...");
    try {
        const dbDate = getDbDate();
        
        // 1. ADATGYŰJTÉS
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${dbDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY }
        });
        
        if (!response.data || !response.data.response) {
            await new ChatMessage({ sender: 'System', text: '⚠️ API HIBA: A sportszolgáltató nem válaszol. Ellenőrizd a kulcsot!' }).save();
            return false;
        }

        const allFixtures = response.data.response;
        const now = new Date();
        
        // LAZÍTOTT SZŰRŐ: Csak azokat dobjuk el, amiknek már vége van, vagy javában zajlanak (pl. 2 órája kezdődtek)
        // De a jövőbeni meccsek mind jók!
        const availableFixtures = allFixtures.filter(f => {
            const matchDate = new Date(f.fixture.date);
            return matchDate > now; // Csak ami a jövőben van
        });

        if (availableFixtures.length === 0) {
            await new ChatMessage({ sender: 'System', text: `⚠️ MAI HIBA: Nincs több elérhető meccs mára (${allFixtures.length} meccsből 0 van hátra).` }).save();
            return false;
        }

        // Top 30 meccs kiválasztása (hogy beleférjen a GPT memóriába)
        // Preferáljuk a nagyobb ligákat, ha lehet, de most egyszerűsítve az első 30-at vesszük.
        const matchData = availableFixtures.slice(0, 30).map(f => {
            const dateObj = new Date(f.fixture.date);
            const timeStr = dateObj.toLocaleTimeString('hu-HU', {hour: '2-digit', minute:'2-digit'});
            return `[${timeStr}] ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`;
        }).join("\n");

        // 2. MEMÓRIA BETÖLTÉSE
        const streak = await calculateStreak();
        let memoryContext = "Ez az új kezdet.";
        if (streak > 0) memoryContext = `Jelenleg ${streak} napos NYERŐ SZÉRIÁBAN vagyunk! Ezt kell fenntartani. Csak biztosat!`;
        else memoryContext = "Tegnap nem nyertünk. Ma kötelező a javítás (Value Bet). Óvatos kockázatkezelés.";

        // 3. AI DÖNTÉS
        const systemPrompt = `
            IDENTITY: Te vagy a "Rafinált Róka" AI Sportfogadó Algoritmus (v6.0).
            CONTEXT: ${memoryContext}
            FELADAT: Válassz ki EGYETLEN meccset a listából, ami a legbiztosabb profitot ígéri (Value Bet).
            PARAMÉTEREK: 
            - Odds: 1.40 és 2.20 között (Ideális).
            - Típus: 1X2, DNB, vagy Over/Under.
            STÍLUS (OUTPUT): Szakmai, tömör, katonás jelentés a Tulajdonosnak (System Owner).
            FORMAT: Kizárólag érvényes JSON format!
            JSON STRUCTURE: { "league": "...", "match": "Hazai vs Vendég", "prediction": "...", "odds": "1.XX", "reasoning": "Főnök! Az elemzés alapján...", "profitPercent": 5, "matchTime": "HH:MM", "bookmaker": "..." }
        `;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: systemPrompt }, 
                { role: "user", content: `A mai kínálat:\n${matchData}` }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        
        // MENTÉS
        await Tip.findOneAndUpdate({ date: dbDate }, { 
            ...result, 
            date: dbDate, 
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

// STATISZTIKA (Javítva: Kezeli az üres adatbázist)
app.get('/stats', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user.hasLicense) return res.redirect('/pricing');
    
    try {
        const monthlyStats = await MonthlyStat.find({ isPublished: true }).sort({ month: -1 }) || [];
        const historyTips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(30) || [];
        res.render('stats', { user, monthlyStats, historyTips, randomQuote: "A számok nem hazudnak." });
    } catch (e) {
        console.error(e);
        res.render('stats', { user, monthlyStats: [], historyTips: [], randomQuote: "Adatbázis hiba." });
    }
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
    
    // Grafikon adat
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

// 1. TIPP PUBLIKÁLÁSA (ZSIVÁNY STÍLUS GENERÁLÁSA ITT TÖRTÉNIK)
app.post('/admin/publish-tip', checkAdmin, async (req, res) => {
    const { tipId } = req.body;
    const tip = await Tip.findById(tipId);
    
    // Itt történik a varázslat: Szakmai szöveg -> Laza üzenet
    const transformPrompt = `
        Forrás (Szakmai): "${tip.reasoning}"
        FELADAT: Írd át ezt a szöveget a "Rafinált Róka" prémium csoport tagjainak.
        STÍLUS: Zsivány Róka. Laza, dörzsölt, magabiztos, tele emojikkal (🦊, 💸, 🔥).
        TILOS: Ne használd a "Főnök" szót (az csak az Adminnak szól).
        HOSSZ: Kb. 3-4 mondat.
        PÉLDA: "Srácok! Ma egy igazi gyöngyszemet találtam a spanyol ligában..."
    `;
    
    const aiRes = await openai.chat.completions.create({ 
        model: "gpt-4-turbo-preview", 
        messages: [{ role: "system", content: "Kreatív Marketinges." }, { role: "user", content: transformPrompt }] 
    });
    
    const memberText = aiRes.choices[0].message.content;
    
    await Tip.findByIdAndUpdate(tipId, { isPublished: true, memberMessage: memberText });
    await new ChatMessage({ sender: 'System', text: '✅ Tipp publikálva! A tagok most már látják a laza verziót.' }).save();
    res.redirect('/admin');
});

// 2. KÉNYSZERÍTETT TÖRLÉS
app.post('/admin/delete-today', checkAdmin, async (req, res) => {
    await Tip.findOneAndDelete({ date: getDbDate() });
    await new ChatMessage({ sender: 'System', text: '🗑️ Tipp törölve. Indíthatsz újat!' }).save();
    res.redirect('/admin');
});

// 3. ELEMZÉS INDÍTÁSA (Visszajelzéssel)
app.post('/admin/run-robot', checkAdmin, async (req, res) => { 
    req.setTimeout(300000); // 5 perc timeout
    const success = await runAiRobot(); 
    if(success) await new ChatMessage({ sender: 'AI', text: '🧠 Kész az elemzés, Főnök! Nézd meg a Vezérlőpultot.' }).save();
    // Ha nem sikerül, a runAiRobot ír a chatbe
    res.redirect('/admin'); 
});

// EGYÉB
app.post('/admin/social-content', checkAdmin, async (req, res) => {
    const { type } = req.body; 
    let context = type === 'win' ? "Téma: NYERTÜNK! Ünnepeljük a profitot." : "Téma: MOTIVÁCIÓ. Csatlakozz a nyerőkhöz.";
    const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Social Media Expert." }, { role: "user", content: `Írj rövid Insta posztot. ${context}` }] });
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