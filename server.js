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

mongoose.connect(process.env.MONGO_URL).then(() => console.log("🚀 Skyhigh Neural v6.0 Engine Online"));

// ADATMODELLEK
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, prediction: String, odds: String, reasoning: String,
    profitPercent: { type: Number, default: 0 }, 
    date: { type: String, default: () => new Date().toLocaleDateString('hu-HU').replace(/\s/g, '') }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_master_ultra_2026',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ROBOT LOGIKA - TESZTELHETŐ ÉS BIZTOS TIPPADÁS
async function runAiRobot(isTest = false) {
    try {
        const todayStr = new Date().toLocaleDateString('hu-HU').replace(/\s/g, '');
        const apiDate = new Date().toISOString().split('T')[0];
        
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${apiDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY }
        });

        let fixtures = response.data.response;

        // Ha nem teszt, akkor szűrünk a 3 órás szabályra
        if (!isTest) {
            fixtures = fixtures.filter(f => {
                const matchTime = new Date(f.fixture.date);
                return (matchTime - new Date()) > (3 * 60 * 60 * 1000);
            });
        }

        if (fixtures.length === 0) return false;

        const matchData = fixtures.slice(0, 20).map(f => `${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`).join(", ");

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ 
                role: "system", 
                content: "Profi sportfogadó matematikus vagy. Kizárólag MAGYAR nyelven válaszolj. Válaszod egy szigorú JSON: {match, prediction, odds, reasoning, profitPercent}" 
            },
            { role: "user", content: `Válaszd ki a nap abszolút legjobb fix tippjét 10 éves statisztika alapján: ${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: todayStr }, result, { upsert: true });
        return true;
    } catch (e) { console.error(e); return false; }
}

const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// ÚTVONALAK
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user.email === OWNER_EMAIL && !user.isAdmin) { user.isAdmin = true; user.hasLicense = true; await user.save(); }
    if (!user.hasLicense || user.startingCapital === 0) return res.render('pricing', { user });
    
    const todayStr = new Date().toLocaleDateString('hu-HU').replace(/\s/g, '');
    const dailyTip = await Tip.findOne({ date: todayStr });
    const history = await Tip.find().sort({ _id: -1 }).limit(10);
    res.render('dashboard', { user, dailyTip, history });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const licensedCount = await User.countDocuments({ hasLicense: true });
    const todayStr = new Date().toLocaleDateString('hu-HU').replace(/\s/g, '');
    const currentTip = await Tip.findOne({ date: todayStr });
    res.render('admin', { users, currentTip, totalRevenue: licensedCount * 19900, licensedCount, status: req.query.status });
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    const success = await runAiRobot(true); // TESZT MÓD BEKAPCSOLVA
    res.redirect(`/admin?status=${success ? 'success' : 'error'}`);
});

app.post('/user/set-capital', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital, hasLicense: true });
    res.redirect('/dashboard');
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else res.send("Belépési hiba!");
});

app.post('/auth/register', async (req, res) => {
    const hashed = await bcrypt.hash(req.body.password, 10);
    await new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashed }).save();
    res.redirect('/login');
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.listen(process.env.PORT || 8080);