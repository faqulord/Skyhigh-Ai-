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

// Adatbázis Kapcsolat
mongoose.connect(process.env.MONGO_URL).then(() => console.log("🚀 Neural Engine Active"));

// ADATMODELLEK
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, reasoning: String,
    profitPercent: { type: Number, default: 0 }, matchTime: String, bookmaker: String,
    status: { type: String, default: 'pending' }, 
    date: { type: String, index: true }
}));

const MonthlyStat = mongoose.model('MonthlyStat', new mongoose.Schema({
    month: String, totalProfit: { type: Number, default: 0 },
    winCount: { type: Number, default: 0 }, totalTips: { type: Number, default: 0 }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_final_fixed_2026',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// EGYSÉGES DÁTUMKEZELÉS (Railway Fix)
const getTodayDate = () => {
    return new Date().toISOString().split('T')[0];
};

// ROBOT FUNKCIÓ - JAVÍTOTT HIBAKEZELÉSSEL
async function runAiRobot(isManual = false) {
    try {
        const dbDate = getTodayDate();
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${dbDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY }
        });

        let fixtures = response.data.response;
        if (!fixtures || fixtures.length === 0) return { success: false, msg: "Nincs elérhető mérkőzés mára." };

        // Időszűrő: Manuális indításnál engedékenyebb, automata indításnál szigorú +3h
        const now = new Date();
        if (!isManual) {
            fixtures = fixtures.filter(f => (new Date(f.fixture.date) - now) > (3 * 60 * 60 * 1000));
        }

        if (fixtures.length === 0) fixtures = response.data.response.slice(0, 10); // Ha nincs +3h, vegyük az elsőket

        const matchData = fixtures.slice(0, 15).map(f => `${f.teams.home.name} vs ${f.teams.away.name} (Bajnokság: ${f.league.name}, Idő: ${f.fixture.date})`).join(" | ");

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ 
                role: "system", 
                content: "Te vagy az 'Öreg Róka'. Profi matematikai alapú sportfogadó. Csak MAGYARUL válaszolj. JSON: {league, match, prediction, odds, reasoning, profitPercent, matchTime, bookmaker}" 
            },
            { role: "user", content: `Elemezd a meccseket és válassz egy MASTER TIPPET: ${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: dbDate }, { ...result, date: dbDate, status: 'pending' }, { upsert: true });
        return { success: true };
    } catch (e) {
        console.error("ROBOT HIBA:", e.message);
        return { success: false, msg: e.message };
    }
}

// BIZTONSÁGI SZŰRŐ
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// ADMIN ÚTVONALAK
app.get('/admin', checkAdmin, async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 });
        const currentTip = await Tip.findOne({ date: getTodayDate() });
        const stats = await MonthlyStat.find().sort({ month: -1 });
        const licensedCount = await User.countDocuments({ hasLicense: true });
        res.render('admin', { users, currentTip, stats, totalRevenue: licensedCount * 19900, status: req.query.status, error: req.query.error });
    } catch (e) { res.status(500).send("Belső szerverhiba az admin betöltésekor."); }
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    req.setTimeout(120000); // 2 perces várakozás az AI miatt
    const result = await runAiRobot(true);
    if (result.success) res.redirect('/admin?status=success');
    else res.redirect(`/admin?status=error&error=${encodeURIComponent(result.msg)}`);
});

app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const { tipId, status } = req.body;
    const tip = await Tip.findById(tipId);
    if (!tip || tip.status !== 'pending') return res.redirect('/admin');

    tip.status = status;
    await tip.save();

    const month = tip.date.substring(0, 7); // YYYY-MM
    let monthlyStat = await MonthlyStat.findOne({ month });
    if (!monthlyStat) monthlyStat = new MonthlyStat({ month });

    monthlyStat.totalTips += 1;
    if (status === 'win') {
        monthlyStat.winCount += 1;
        monthlyStat.totalProfit += parseFloat(tip.profitPercent);
    } else {
        monthlyStat.totalProfit -= 10; 
    }
    await monthlyStat.save();
    res.redirect('/admin?status=settled');
});

// DASHBOARD
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user.hasLicense || user.startingCapital === 0) return res.render('pricing', { user });
    
    const dailyTip = await Tip.findOne({ date: getTodayDate() });
    const history = await Tip.find({ status: { $ne: 'pending' } }).sort({ _id: -1 }).limit(10);
    const recommendedStake = Math.floor(user.startingCapital * 0.10);

    res.render('dashboard', { user, dailyTip, history, recommendedStake });
});

// ALAP ÚTVONALAK
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
    const newUser = new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashed });
    if (req.body.email.toLowerCase() === OWNER_EMAIL) newUser.isAdmin = true;
    await newUser.save();
    res.redirect('/login');
});

app.listen(process.env.PORT || 8080);