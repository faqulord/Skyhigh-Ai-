const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const axios = require('axios');
const { OpenAI } = require('openai');
const path = require('path');
const app = express();

// --- KONFIGURÁCIÓ (RAILWAY VÁLTOZÓK) ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SPORT_API_KEY = process.env.SPORT_API_KEY; // Ellenőrizd a Railway-en a nevet!
const MONGO_CONNECTION = process.env.MONGO_URL;

mongoose.connect(MONGO_CONNECTION).then(() => console.log("🚀 Skyhigh Neural Engine Online"));

// --- MODELLEK ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true }, password: String,
    startingCapital: { type: Number, default: 0 }, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, prediction: String, odds: String, reasoning: String,
    date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}));

// --- BEÁLLÍTÁSOK ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'skyhigh_neural_2026',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_CONNECTION })
}));

// --- 🤖 AI MASTER TIP GENERÁTOR ---
async function runAiAnalysis() {
    try {
        const today = new Date().toISOString().split('T')[0];
        console.log("📊 API Adatgyűjtés: " + today);

        // Mai top meccsek lekérése (PL, La Liga, stb.)
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${today}`, {
            headers: { 'x-apisports-key': SPORT_API_KEY }
        });

        const fixtures = response.data.response.slice(0, 15);
        const matchData = fixtures.map(f => `${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`).join(", ");

        // OpenAI GPT-4 elemzés
        const aiResponse = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{
                role: "system",
                content: "Profi sportfogadási matematikus vagy. Válassz egy Master Tippet. Válasz csak JSON: {match, prediction, odds, reasoning}"
            }, {
                role: "user",
                content: `Meccsek: ${matchData}`
            }]
        });

        const result = JSON.parse(aiResponse.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: today }, result, { upsert: true });
        console.log("✅ AI Master Tipp Mentve: " + result.match);
    } catch (err) { console.error("❌ AI Hiba:", err.message); }
}

// Futattás minden reggel 8-kor
cron.schedule('0 8 * * *', runAiAnalysis);

// --- ÚTVONALAK ---

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    
    if (!user.hasLicense && !user.isAdmin) return res.render('buy-license', { user });

    const today = new Date().toISOString().split('T')[0];
    const dailyTip = await Tip.findOne({ date: today });
    res.render('dashboard', { user, dailyTip });
});

app.get('/admin', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user || !user.isAdmin) return res.send("Hozzáférés megtagadva!");
    const allUsers = await User.find().sort({ createdAt: -1 });
    res.render('admin', { user, allUsers });
});

// Admin gomb: AI indítása manuálisan
app.post('/admin/run-ai', async (req, res) => {
    const user = await User.findById(req.session.userId);
    if (user.isAdmin) {
        await runAiAnalysis();
        res.redirect('/admin');
    }
});

// Admin gomb: Licenc ki/bekapcsolás
app.post('/admin/toggle-license/:id', async (req, res) => {
    const user = await User.findById(req.session.userId);
    if (user.isAdmin) {
        const target = await User.findById(req.params.id);
        target.hasLicense = !target.hasLicense;
        await target.save();
        res.redirect('/admin');
    }
});

// AUTH LOGIKA
app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else { res.send("Hibás belépés!"); }
});

app.post('/auth/register', async (req, res) => {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    await new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashedPassword }).save();
    res.redirect('/login');
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Skyhigh Master Engine Online`));