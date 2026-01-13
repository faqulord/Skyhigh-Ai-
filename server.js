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

mongoose.connect(process.env.MONGO_URL).then(() => console.log("🚀 Skyhigh Motor v8.0 Online"));

const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, prediction: String, odds: String, reasoning: String,
    profitPercent: { type: Number, default: 0 }, 
    date: { type: String, index: true }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_v8_final',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const getDbDate = () => new Date().toISOString().split('T')[0];

async function runAiRobot() {
    try {
        const dbDate = getDbDate();
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${dbDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY }
        });

        const fixtures = response.data.response;
        if (!fixtures || fixtures.length === 0) return false;

        const matchData = fixtures.slice(0, 20).map(f => `${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`).join(", ");

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: "Profi sportfogadó matematikus vagy. Kizárólag MAGYAR nyelven válaszolj. Válasz JSON: {match, prediction, odds, reasoning, profitPercent}" },
                       { role: "user", content: `Végezz 10 éves mélyanalízist és válassz egy MASTER TIPPET: ${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: dbDate }, { ...result, date: dbDate }, { upsert: true });
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
    if (user.email === OWNER_EMAIL && !user.isAdmin) { user.isAdmin = true; user.hasLicense = true; await user.save(); }
    if (!user.hasLicense || user.startingCapital === 0) return res.render('pricing', { user });
    const dailyTip = await Tip.findOne({ date: getDbDate() });
    const history = await Tip.find().sort({ _id: -1 }).limit(10);
    res.render('dashboard', { user, dailyTip, history, displayDate: new Date().toLocaleDateString('hu-HU') });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const licensedCount = await User.countDocuments({ hasLicense: true });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    res.render('admin', { users, currentTip, totalRevenue: licensedCount * 19900, licensedCount, status: req.query.status });
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    req.setTimeout(180000); // 3 percre növelt várakozási idő
    const success = await runAiRobot();
    res.redirect(`/admin?status=${success ? 'success' : 'error'}`);
});

// Többi útvonal változatlan...
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/', (req, res) => res.render('index'));
app.post('/user/set-capital', async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital, hasLicense: true });
    res.redirect('/dashboard');
});
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