const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const nodemailer = require('nodemailer');
const path = require('path');
const cron = require('node-cron');
const app = express();

// ALAPBEÁLLÍTÁSOK
const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const BRAND_NAME = "Rafinált Róka"; 

// EMAIL KÜLDŐ (Saját adataiddal a .env-ben)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER || OWNER_EMAIL, pass: process.env.EMAIL_PASS }
});

// ADATBÁZIS CSATLAKOZÁS
mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log(`🚀 ${BRAND_NAME} System Online | 2026-01-14`))
    .catch(err => console.error("MongoDB hiba:", err));

// --- ADAT MODELLER ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, 
    email: { type: String, unique: true, lowercase: true },
    password: String, 
    hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 }
}, { timestamps: true }));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    league: String, 
    match: String, 
    prediction: String, 
    odds: String, 
    reasoning: String,      // Az "Öreg Róka" jelentése neked
    memberMessage: String,  // A "Zsivány Róka" üzenete a tagoknak
    profitPercent: { type: Number, default: 5 }, 
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }
}));

const MonthlyStat = mongoose.model('MonthlyStat', new mongoose.Schema({
    month: String, 
    totalProfit: { type: Number, default: 0 }, 
    winCount: { type: Number, default: 0 }, 
    totalTips: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: false }
}));

const ChatMessage = mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, 
    text: String, 
    timestamp: { type: Date, default: Date.now }
}));

// MIDDLEWARE
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'skyhigh_fox_ultra_secret',
    resave: true, 
    saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getDbDate = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

// --- 🦊 ROBOT MOTOR: AZ ELEMZÉS FOLYAMATA ---
async function runAiRobot() {
    try {
        const dbDate = getDbDate();
        console.log(`🤖 Róka elemzés indul: ${dbDate}`);

        // 1. Meccsek lekérése az API-ból
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${dbDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY }
        });

        if (!response.data.response || response.data.response.length === 0) return false;

        // Csak a következő 40 meccset nézzük a GPT keret miatt
        const fixtures = response.data.response.slice(0, 40).map(f => 
            `ID: ${f.fixture.id} | ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name}) | Kezdés: ${f.fixture.date}`
        ).join("\n");

        // 2. AI Elemzés (AZ ÖREG RÓKA STÍLUSA - JELENTÉS AZ ADMINNAK)
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: "Te vagy a 'Rafinált Róka' szakmai agya. Profi sportfogadó elemző. Csak JSON-t válaszolj az alábbi mezőkkel: league, match, prediction, odds, reasoning (szakmai indoklás az Adminnak), profitPercent." },
                { role: "user", content: `Keresd meg a mai nap legmagasabb valószínűségű tippjét: \n${fixtures}` }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);

        // 3. Mentés (Még nem publikus!)
        await Tip.findOneAndUpdate(
            { date: dbDate }, 
            { ...result, date: dbDate, isPublished: false, status: 'pending' }, 
            { upsert: true }
        );

        return true;
    } catch (e) {
        console.error("Robot hiba:", e);
        return false;
    }
}

// AUTOMATIZÁLT INDÍTÁS REGGEL 8:00
cron.schedule('0 8 * * *', () => {
    runAiRobot();
}, { timezone: "Europe/Budapest" });

// ADMIN ELLENŐRZŐ
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- ÚTVONALAK ---

// USER DASHBOARD
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    
    // Jogosultság check
    if (!user.hasLicense && user.email !== OWNER_EMAIL) return res.redirect('/pricing');
    if (user.startingCapital === 0) return res.render('set-capital', { user });

    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    
    // BANKROLL MATEK (10% javasolt tét)
    const recommendedStake = Math.floor(user.startingCapital * 0.10);

    res.render('dashboard', { 
        user, 
        dailyTip, 
        recommendedStake, 
        displayDate: new Date().toLocaleDateString('hu-HU'),
        randomQuote: "A türelem profitot terem, tesó." 
    });
});

// ADMIN PANEL (AZ EGÉSZ RENDSZER KEZELÉSE)
app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const recentTips = await Tip.find().sort({ date: -1 }).limit(10);
    const stats = await MonthlyStat.find().sort({ month: -1 });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(30);

    res.render('admin', { 
        users, currentTip, recentTips, stats, chatHistory, 
        dbDate: getDbDate(), brandName: BRAND_NAME 
    });
});

// AZONNALI ROBOT INDÍTÁS GOMB
app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    console.log("🚀 Főnök elindította a kézi elemzést...");
    const success = await runAiRobot();
    res.redirect('/admin');
});

// PUBLIKÁLÁS GOMB (ITT VÁLT ÁT ZSIVÁNYBA A RÓKA)
app.post('/admin/publish-tip', checkAdmin, async (req, res) => {
    const { tipId } = req.body;
    const tip = await Tip.findById(tipId);
    
    // AI Copywriter: Átírja a szakmai szöveget ZSIVÁNY stílusra
    const aiRes = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
            { role: "system", content: "Te vagy a Zsivány Róka. Vagány, dörzsölt, magabiztos tinédzser stílus. Használj szlenget (vágod, tesó, matek, dől a lé). Rövid, ütős üzenet a tagoknak!" },
            { role: "user", content: `Írd át ezt a tippet a tagoknak: ${tip.reasoning}` }
        ]
    });

    await Tip.findByIdAndUpdate(tipId, { 
        isPublished: true, 
        memberMessage: aiRes.choices[0].message.content 
    });
    
    console.log("📢 Tipp publikálva a tagoknak zsivány stílusban!");
    res.redirect('/admin');
});

// EREDMÉNY RÖGZÍTÉS (WIN/LOSS)
app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const { tipId, status } = req.body;
    const tip = await Tip.findById(tipId);
    if (!tip) return res.redirect('/admin');

    tip.status = status; 
    await tip.save();
    
    const month = tip.date.substring(0, 7);
    let ms = await MonthlyStat.findOne({ month }) || new MonthlyStat({ month });
    
    ms.totalTips += 1;
    if (status === 'win') {
        ms.winCount += 1;
        ms.totalProfit += tip.profitPercent;
    } else if (status === 'loss') {
        ms.totalProfit -= 10; // 10% veszteség teli tétnél
    }
    await ms.save();
    res.redirect('/admin');
});

// --- AUTH & MISC ---
app.post('/auth/register', async (req, res) => {
    const hashed = await bcrypt.hash(req.body.password, 10);
    try {
        const user = await new User({ 
            fullname: req.body.fullname, 
            email: req.body.email.toLowerCase(), 
            password: hashed 
        }).save();
        req.session.userId = user._id; 
        res.redirect('/pricing');
    } catch(e) { res.send("Email már regisztrálva!"); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else res.send("Hibás adatok!");
});

app.post('/user/set-capital', async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital });
    res.redirect('/dashboard');
});

// OLDALAK
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/pricing', (req, res) => res.render('pricing'));
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.get('/', (req, res) => res.render('index'));

app.listen(process.env.PORT || 8080);