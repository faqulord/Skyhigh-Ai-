const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const path = require('path');
const app = express();

const OWNER_EMAIL = "stylefaqu@gmail.com"; 

mongoose.connect(process.env.MONGO_URL).then(() => console.log("🚀 Rafinált Robot Róka v22.0 - ONLINE"));

// ADATMODELLEK
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, reasoning: String,
    profitPercent: { type: Number, default: 0 }, matchTime: String, bookmaker: String,
    status: { type: String, default: 'pending' }, date: { type: String, index: true }
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
    secret: 'skyhigh_purple_fox_v22_final',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getDbDate = () => new Date().toLocaleDateString('en-CA'); 
const getHuFullDate = () => new Date().toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });

// ROBOT MOTOR + AUTOMATA JELENTÉS
async function runAiRobot() {
    try {
        const dbDate = getDbDate();
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${dbDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY }
        });
        const now = new Date();
        const fixtures = response.data.response.filter(f => (new Date(f.fixture.date) - now) > (3 * 60 * 60 * 1000));
        if (fixtures.length === 0) return false;
        
        const matchData = fixtures.slice(0, 15).map(f => `${f.teams.home.name} vs ${f.teams.away.name} (Eredmények.com liga: ${f.league.name}, Idő: ${new Date(f.fixture.date).toLocaleTimeString('hu-HU', {hour:'2-digit', minute:'2-digit', timeZone:'Europe/Budapest'})})`).join(" | ");
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Te vagy a 'Rafinált Robot Róka'. Cyber-sportfogadó zseni. Csak MAGYARUL válaszolj. Válasz JSON: {league, match, prediction, odds, reasoning, profitPercent, matchTime, bookmaker}" },
                       { role: "user", content: `Add meg a nap Master Tippjét: ${matchData}` }],
            response_format: { type: "json_object" }
        });
        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: dbDate }, { ...result, date: dbDate, status: 'pending' }, { upsert: true });

        const report = `Főnök, a mai elemzés kész! Kiválasztottam: ${result.match}. A matek szerint @${result.odds} szorzón hatalmas érték van. A 30 napos stratégia szerint haladunk tovább!`;
        await new ChatMessage({ sender: 'Róka', text: report }).save();

        return true;
    } catch (e) { return false; }
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

    const dailyTip = await Tip.findOne({ date: getDbDate() });
    const history = await Tip.find({ status: { $ne: 'pending' } }).sort({ _id: -1 }).limit(5);
    const recommendedStake = Math.floor(user.startingCapital * 0.10);
    const nextTipText = (new Date().getHours() < 8) ? "Ma 08:00" : "Holnap 08:00";
    res.render('dashboard', { user, dailyTip, history, recommendedStake, displayDate: getHuFullDate(), nextTipText });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
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

    res.render('admin', { users, currentTip, stats, calculatorData, chatHistory, dbDate: getDbDate(), status: req.query.status, tipExists: !!currentTip, currentMonthName: new Date().toLocaleDateString('hu-HU', { month: 'long', year: 'numeric' }) });
});

app.post('/admin/chat', checkAdmin, async (req, res) => {
    try {
        await new ChatMessage({ sender: 'Admin', text: req.body.message }).save();
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Te vagy a Rafinált Robot Róka. Főnökkel beszélsz." }, { role: "user", content: req.body.message }]
        });
        const reply = aiRes.choices[0].message.content;
        await new ChatMessage({ sender: 'Róka', text: reply }).save();
        res.json({ reply });
    } catch (e) { res.status(500).send("Hiba"); }
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    req.setTimeout(180000); await runAiRobot();
    res.redirect('/admin?status=success');
});

app.post('/admin/activate-user', checkAdmin, async (req, res) => {
    await User.findByIdAndUpdate(req.body.userId, { hasLicense: true });
    res.redirect('/admin');
});

app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const { tipId, status } = req.body;
    const tip = await Tip.findById(tipId);
    tip.status = status; await tip.save();
    const month = tip.date.substring(0, 7);
    let ms = await MonthlyStat.findOne({ month }) || new MonthlyStat({ month });
    ms.totalTips += 1;
    if (status === 'win') { ms.winCount += 1; ms.totalProfit += tip.profitPercent; }
    else { ms.totalProfit -= 10; }
    await ms.save();
    res.redirect('/admin');
});

// AUTH & UTILS
app.post('/auth/register', async (req, res) => {
    const hashed = await bcrypt.hash(req.body.password, 10);
    const user = await new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashed }).save();
    req.session.userId = user._id; res.redirect('/pricing');
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id; req.session.save(() => res.redirect('/dashboard'));
    } else res.send("Hiba!");
});

app.post('/user/set-capital', async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital });
    res.redirect('/dashboard');
});

app.get('/pricing', (req, res) => res.render('pricing'));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/', (req, res) => res.render('index'));
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.listen(process.env.PORT || 8080);