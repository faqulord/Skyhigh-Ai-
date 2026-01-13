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

// --- KONFIGURÁCIÓ (RAILWAY VÁLTOZÓK HASZNÁLATA) ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SPORT_API_KEY = process.env.SPORT_API_KEY;
const MONGO_CONNECTION = process.env.MONGO_URL;

mongoose.connect(MONGO_CONNECTION).then(() => console.log("🚀 Skyhigh Neural Engine Active"));

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
    secret: 'skyhigh_quantum_safe_2026',
    resave: false, saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_CONNECTION })
}));

// --- 🤖 AI MASTER TIP GENERÁTOR (MATEMATIKAI ALAPOKON) ---
async function generateDailyMasterTip() {
    try {
        console.log("📊 Adatgyűjtés és matematikai elemzés indítása...");
        const today = new Date().toISOString().split('T')[0];
        
        // Mai meccsek lekérése a top bajnokságokból
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${today}`, {
            headers: { 'x-apisports-key': SPORT_API_KEY }
        });

        const fixtures = response.data.response.slice(0, 15);
        const matchSummary = fixtures.map(f => `${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name}) - Odds: 1.5-2.5`).join(", ");

        // OpenAI GPT-4 Elemzés
        const aiResponse = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{
                role: "system",
                content: "Profi sportfogadási AI vagy. Elemezd a meccseket, és válaszd ki az egyetlen legmagasabb (85%+) valószínűségű Master Tippet. Csak JSON-ban válaszolj: {'match': '...', 'prediction': '...', 'odds': '...', 'reasoning': '...'}"
            }, {
                role: "user",
                content: `Válaszd ki a mai legjobb tippet ezek közül: ${matchSummary}`
            }]
        });

        const result = JSON.parse(aiResponse.choices[0].message.content);
        await Tip.findOneAndDelete({ date: today }); // Takarítás
        await new Tip(result).save();
        console.log("✅ Mai Master Tipp rögzítve!");
    } catch (err) { console.error("❌ Robot hiba:", err); }
}

// Robot indítása minden reggel 8:00-kor
cron.schedule('0 8 * * *', generateDailyMasterTip);

// --- ÚTVONALAK ---

app.get('/', (req, res) => res.render('index'));

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    
    // LICENC ELLENŐRZÉS: Ha nincs licence és nem admin, akkor a fizető oldalra megy
    if (!user.hasLicense && !user.isAdmin) return res.render('buy-license', { user });

    const today = new Date().toISOString().split('T')[0];
    const dailyTip = await Tip.findOne({ date: today });
    res.render('dashboard', { user, dailyTip });
});

app.get('/admin', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user.isAdmin) return res.send("Unauthorized");
    const allUsers = await User.find().sort({ createdAt: -1 });
    res.render('admin', { user, allUsers });
});

// AUTH LOGIKA
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else { res.send("Hibás adatok!"); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Skyhigh Master Engine Online`));