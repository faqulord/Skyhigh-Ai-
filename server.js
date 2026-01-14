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

// --- RÓKA SZLENGEK ÉS BÖLCSESSÉGEK (ÉLMÉNYADÁS) ---
const foxQuotes = [
    "A pénz nem boldogít, de a nyerő szelvény határozottan segít! 🦊💸",
    "Mondtam a főnökömnek, hogy ma beteg vagyok. Tippmix-lázam van. 🤒📝",
    "A fogadóirodák már remegnek, érzem a szagot... 😤",
    "Ma nem dolgozni jöttünk, hanem kaszálni. 🌾💰",
    "A statisztika a barátunk, az érzelmek az ellenségeink. Maradj hidegvérű! ❄️",
    "Egy nap a tengerparton fogunk koktélozni ebből. Kitartás! 🍹🌴",
    "A bankroll menedzsment nem szexi, de gazdaggá tesz. 📈",
    "Csak a Zsiványok élik túl. A többiek elbukják a fizetésüket. 🦊👊"
];

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || OWNER_EMAIL, 
        pass: process.env.EMAIL_PASS 
    }
});

mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 ${BRAND_NAME} System Ready - EXPERIENCE MODE`));

const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, // Ezt csak TE látod
    memberMessage: String, // Ezt látják a TAGOK
    profitPercent: { type: Number, default: 0 }, matchTime: String, bookmaker: String,
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }
}));

const MonthlyStat = mongoose.model('MonthlyStat', new mongoose.Schema({
    month: String, totalProfit: { type: Number, default: 0 }, winCount: { type: Number, default: 0 }, totalTips: { type: Number, default: 0 }
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
    secret: 'skyhigh_boss_system_secret',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getDbDate = () => new Date().toLocaleDateString('en-CA'); 

// ROBOT MOTOR
async function runAiRobot() {
    try {
        const dbDate = getDbDate();
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${dbDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY }
        });
        
        const now = new Date();
        const fixtures = response.data.response.filter(f => (new Date(f.fixture.date) - now) > (1 * 60 * 60 * 1000));
        
        if (fixtures.length === 0) return false;

        const matchData = fixtures.slice(0, 40).map(f => `[${f.fixture.date}] ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`).join("\n");

        const systemPrompt = `
            IDENTITY: Te vagy a "Rafinált Róka". A matematika mestere.
            NYELV: MAGYAR.
            FELADAT: Keress Value Betet. Írj jelentést a Főnöknek.
            OUTPUT JSON: { "league": "...", "match": "...", "prediction": "...", "odds": "...", "reasoning": "Főnök! [Elemzés]...", "profitPercent": 5, "matchTime": "...", "bookmaker": "..." }
        `;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Elemezz: \n${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: dbDate }, { ...result, date: dbDate, status: 'pending', isPublished: false }, { upsert: true });
        return true;
    } catch (e) { return false; }
}

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
    const pastTips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(20);
    const recommendedStake = Math.floor(user.startingCapital * 0.10);
    
    // VÉLETLENSZERŰ IDÉZET KIVÁLASZTÁSA
    const randomQuote = foxQuotes[Math.floor(Math.random() * foxQuotes.length)];
    
    res.render('dashboard', { user, dailyTip, pastTips, recommendedStake, displayDate: new Date().toLocaleDateString('hu-HU'), randomQuote });
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
    const tip = await Tip.findById(tipId);

    // AI TRANSFORMER: FŐNÖK -> HAVEROK
    const transformPrompt = `
        Eredeti: "${tip.reasoning}"
        
        Feladat: Írd át ezt a szöveget a Sportfogadó Csoport tagjainak.
        Szerep: Te vagy a "Zsivány Róka", a csoport vezére.
        Stílus: Laza, motiváló, haveri. "Srácok", "Banda". Használj emojikat.
        TILOS: Ne használd a "Főnök" szót!
    `;

    const aiRes = await openai.chat.completions.create({ 
        model: "gpt-4-turbo-preview", 
        messages: [{ role: "system", content: "Laza szövegíró vagy." }, { role: "user", content: transformPrompt }] 
    });
    
    const memberText = aiRes.choices[0].message.content;

    await Tip.findByIdAndUpdate(tipId, { isPublished: true, memberMessage: memberText });
    res.redirect('/admin');
});

// MARADÉK LOGIKA VÁLTOZATLAN...
app.post('/admin/chat', checkAdmin, async (req, res) => {
    await new ChatMessage({ sender: 'Főnök', text: req.body.message }).save();
    const adminPrompt = `Te vagy a ${BRAND_NAME} (Belső Én). Katonás, profi stratéga vagy. Beszélj a Főnökkel.`;
    const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: adminPrompt }, { role: "user", content: req.body.message }] });
    const reply = aiRes.choices[0].message.content;
    await new ChatMessage({ sender: 'AI', text: reply }).save();
    res.json({ reply });
});

app.post('/admin/draft-email', checkAdmin, async (req, res) => {
    const topic = req.body.topic;
    const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Marketing Expert." }, { role: "user", content: `Téma: ${topic}` }] });
    res.json({ draft: aiRes.choices[0].message.content });
});

app.post('/admin/send-email', checkAdmin, async (req, res) => {
    const { subject, messageBody } = req.body;
    try {
        const recipients = await User.find({ hasLicense: true });
        const emails = recipients.map(u => u.email);
        if(emails.length === 0) return res.redirect('/admin');
        await transporter.sendMail({ from: `"${BRAND_NAME}" <${process.env.EMAIL_USER || OWNER_EMAIL}>`, to: process.env.EMAIL_USER || OWNER_EMAIL, bcc: emails, subject: subject, text: messageBody, html: messageBody.replace(/\n/g, '<br>') });
        res.redirect('/admin');
    } catch (e) { console.error(e); res.redirect('/admin'); }
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => { req.setTimeout(180000); await runAiRobot(); res.redirect('/admin'); });
app.post('/admin/activate-user', checkAdmin, async (req, res) => { await User.findByIdAndUpdate(req.body.userId, { hasLicense: true }); res.redirect('/admin'); });
app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const { tipId, status } = req.body;
    const tip = await Tip.findById(tipId);
    if (tip.status !== status) {
        tip.status = status; await tip.save();
        const month = tip.date.substring(0, 7);
        let ms = await MonthlyStat.findOne({ month }) || new MonthlyStat({ month });
        ms.totalTips += 1;
        if (status === 'win') { ms.winCount += 1; ms.totalProfit += tip.profitPercent; }
        else if (status === 'loss') { ms.totalProfit -= 10; }
        await ms.save();
    }
    res.redirect('/admin');
});
app.post('/auth/register', async (req, res) => { if (!req.body.terms) return res.send("Hiba: ÁSZF!"); const hashed = await bcrypt.hash(req.body.password, 10); try { const user = await new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashed }).save(); req.session.userId = user._id; res.redirect('/pricing'); } catch(e) { res.send("Email foglalt!"); } });
app.post('/auth/login', async (req, res) => { const user = await User.findOne({ email: req.body.email.toLowerCase() }); if (user && await bcrypt.compare(req.body.password, user.password)) { req.session.userId = user._id; req.session.save(() => res.redirect('/dashboard')); } else res.send("Hiba!"); });
app.post('/user/set-capital', async (req, res) => { await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital }); res.redirect('/dashboard'); });
app.get('/terms', (req, res) => res.render('terms')); app.get('/login', (req, res) => res.render('login')); app.get('/register', (req, res) => res.render('register')); app.get('/', (req, res) => res.render('index')); app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.listen(process.env.PORT || 8080);