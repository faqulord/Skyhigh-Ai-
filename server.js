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

// --- TULAJDONOSI KONFIGURÁCIÓ ---
const OWNER_EMAIL = "stylefaqu@gmail.com"; 

// --- API ÉS DB KAPCSOLAT (Railway változókból) ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SPORT_API_KEY = process.env.SPORT_API_KEY; 
const MONGO_CONNECTION = process.env.MONGO_URL;

mongoose.connect(MONGO_CONNECTION)
    .then(() => console.log("🚀 Skyhigh Neural Engine Online & Connected"))
    .catch(err => console.error("❌ Adatbázis hiba:", err));

// --- ADATMODELL ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String,
    email: { type: String, unique: true, lowercase: true },
    password: String,
    hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, 
    prediction: String, 
    odds: String, 
    reasoning: String,
    date: { type: String, default: () => new Date().toISOString().split('T')[0] },
    timestamp: { type: Date, default: Date.now }
}));

// --- MIDDLEWARE & BEÁLLÍTÁSOK ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_neural_quantum_key_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_CONNECTION }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 napos munkamenet
}));

// --- 🤖 PROFI AI ELEMZŐ ROBOT (Cron Job: 08:00) ---
async function runMasterAnalysis() {
    try {
        const today = new Date().toISOString().split('T')[0];
        console.log(`[${new Date().toLocaleString()}] AI Elemzés indítása...`);

        // Mai meccsek lekérése (PL, La Liga, Serie A, Bundesliga)
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${today}`, {
            headers: { 'x-apisports-key': SPORT_API_KEY }
        });

        const fixtures = response.data.response.slice(0, 20);
        const matchData = fixtures.map(f => `${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`).join(", ");

        if (fixtures.length === 0) {
            console.log("⚠️ Nincs elég meccs az elemzéshez.");
            return;
        }

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: "Te egy profi sportfogadási matematikus vagy. Válaszd ki a nap egyetlen legbiztosabb tippjét (Master Tip). Csak JSON formátumban válaszolj: { 'match': '...', 'prediction': '...', 'odds': '...', 'reasoning': '...' }" },
                { role: "user", content: `Elemezd ezeket a meccseket: ${matchData}` }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: today }, result, { upsert: true });
        console.log("✅ Mai Master Tipp publikálva a rendszerben.");
    } catch (e) {
        console.error("❌ Robot Hiba:", e.message);
    }
}

// Automatizált indítás minden reggel 8-kor
cron.schedule('0 8 * * *', runMasterAnalysis);

// --- ÚTVONALAK ---

// Kezdőlap
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('index');
});

// Login & Regisztráció
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// DASHBOARD (Licenc-fal és Tulajdonos felismerés)
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    
    const user = await User.findById(req.session.userId);

    // AUTOMATIKUS ADMIN/TULAJDONOS FELISMERÉS
    if (user.email === OWNER_EMAIL && !user.isAdmin) {
        user.isAdmin = true;
        user.hasLicense = true;
        await user.save();
    }

    // Ha nincs licenc és nem admin, átirányítjuk a csomagokhoz
    if (!user.hasLicense && !user.isAdmin) {
        return res.render('pricing', { user }); 
    }

    const today = new Date().toISOString().split('T')[0];
    const dailyTip = await Tip.findOne({ date: today });
    const history = await Tip.find().sort({ date: -1 }).limit(30);

    res.render('dashboard', { user, dailyTip, history });
});

// ADMIN PANEL
app.get('/admin', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user.isAdmin) return res.redirect('/dashboard');

    const users = await User.find().sort({ createdAt: -1 });
    res.render('admin', { user, users });
});

// ADMIN MŰVELETEK (Robot manuális indítása)
app.post('/admin/force-ai', async (req, res) => {
    await runMasterAnalysis();
    res.redirect('/admin');
});

// ADMIN MŰVELETEK (Licenc adása kézzel)
app.post('/admin/give-license/:id', async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { hasLicense: true });
    res.redirect('/admin');
});

// AUTH LOGIKA
app.post('/auth/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const newUser = new User({
            fullname: req.body.fullname,
            email: req.body.email.toLowerCase(),
            password: hashedPassword
        });
        await newUser.save();
        res.redirect('/login');
    } catch (e) {
        res.send("Regisztrációs hiba (valószínűleg foglalt email).");
    }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else {
        res.send("Hibás email cím vagy jelszó!");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// --- SZERVER INDÍTÁSA ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Skyhigh Master Engine Online - Port: ${PORT}`);
});