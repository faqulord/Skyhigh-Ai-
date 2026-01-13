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

mongoose.connect(process.env.MONGO_URL).then(() => console.log("🚀 Neural Engine v4.0 Online"));

// ADATMODELLEK
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}, { timestamps: true }));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, prediction: String, odds: String, reasoning: String,
    profitPercent: { type: Number, default: 0 }, 
    date: { type: String, default: () => new Date().toLocaleDateString('hu-HU') }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_neural_ultra_2026',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ROBOT LOGIKA
async function runAiRobot() {
    try {
        const today = new Date().toLocaleDateString('hu-HU');
        const apiDate = new Date().toISOString().split('T')[0];
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${apiDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY }
        });
        const matches = response.data.response.slice(0, 15).map(m => `${m.teams.home.name} vs ${m.teams.away.name}`).join(", ");
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Profi sportfogadó matematikus vagy. Kizárólag MAGYAR nyelven válaszolj. Válasz JSON: {match, prediction, odds, reasoning, profitPercent}" },
                       { role: "user", content: `Elemezz 10 évre visszamenőleg: ${matches}` }],
            response_format: { type: "json_object" }
        });
        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: today }, result, { upsert: true });
        return true;
    } catch (e) { throw e; }
}

// JOGOSULTSÁG ELLENŐRZŐ
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
    const today = new Date().toLocaleDateString('hu-HU');
    const dailyTip = await Tip.findOne({ date: today });
    const history = await Tip.find().sort({ _id: -1 }).limit(10);
    res.render('dashboard', { user, dailyTip, history });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const tips = await Tip.find().sort({ _id: -1 }).limit(30);
    const licensedCount = await User.countDocuments({ hasLicense: true });
    res.render('admin', { users, tips, totalRevenue: licensedCount * 49, licensedCount, status: req.query.status });
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    try { await runAiRobot(); res.redirect('/admin?status=success'); } catch (e) { res.redirect('/admin?status=error'); }
});

app.post('/user/set-capital', async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital, hasLicense: true });
    res.redirect('/dashboard');
});

app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/', (req, res) => res.render('index'));

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else res.send("Hiba!");
});

app.post('/auth/register', async (req, res) => {
    const hashed = await bcrypt.hash(req.body.password, 10);
    await new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashed }).save();
    res.redirect('/login');
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.listen(process.env.PORT || 8080);