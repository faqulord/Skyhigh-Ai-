const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');
const axios = require('axios');
const OpenAI = require('openai');

const User = require('./models/User');
const Tip = require('./models/Tip');

const app = express();

// ======================================================
// 🔑 KULCSOK (Railway Environment Variables)
// ======================================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
const SPORT_API_KEY = process.env.SPORT_API_KEY; 

if (!OPENAI_API_KEY || !SPORT_API_KEY) {
    console.error("⚠️ FIGYELEM: A kulcsok nincsenek beállítva a Railway-en!");
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ======================================================

const dbURI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/skyhigh';
mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB SIKERESEN CSATLAKOZTATVA'))
    .catch(err => console.log('❌ FATÁLIS DB HIBA:', err));

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET || 'director_secret_key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- JOGOSULTSÁGOK ---
const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.send('<h1>Nem vagy bejelentkezve! <a href="/login">Belépés</a></h1>');
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.isAdmin) return res.redirect('/dashboard');
    next();
};

// --- ÚTVONALAK ---
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render('login'));
app.get('/regisztracio', (req, res) => res.render('register'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.post('/auth/register', async (req, res) => {
    const { fullname, email, password } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        await new User({ fullname, email, password: hashed }).save();
        res.redirect('/login');
    } catch (e) { res.send('Email foglalt.'); }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if(user && await bcrypt.compare(password, user.password)){
        req.session.userId = user._id;
        req.session.isAdmin = (email === 'stylefaqu@gmail.com');
        res.redirect('/dashboard');
    } else { res.send('Hibás adatok'); }
});

app.get('/dashboard', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    if (user.licenseExpires && new Date() > user.licenseExpires) {
        user.hasLicense = false;
        await user.save();
    }
    const todayTip = await Tip.findOne().sort({ createdAt: -1 });
    res.render('dashboard', { user, isAdmin: req.session.isAdmin, dailyTip: todayTip });
});

app.get('/fizetes', requireLogin, (req, res) => res.render('pay'));

app.post('/pay/create-checkout-session', requireLogin, async (req, res) => {
    const { plan } = req.body;
    const user = await User.findById(req.session.userId);
    let days = 0; let price = 0; let type = '';
    if (plan === 'monthly') { days = 30; price = 20000; type = 'Havi Licenc'; }
    else if (plan === 'biannual') { days = 180; price = 100000; type = 'Féléves Profi Licenc'; }
    else if (plan === 'annual') { days = 365; price = 180000; type = 'Éves Befektetői Licenc'; }
    
    const expiry = new Date(); expiry.setDate(expiry.getDate() + days);
    user.hasLicense = true; user.licenseExpires = expiry; user.licenseType = type; user.totalSpent = (user.totalSpent || 0) + price;
    await user.save();
    res.render('pay_success', { plan: type, date: expiry.toLocaleDateString() });
});

// ======================================================
// 🤖 AI KOMBI-SZELVÉNY GENERÁTOR (PROFI VERZIÓ)
// ======================================================

app.get('/admin/generate-tip', requireLogin, requireAdmin, async (req, res) => {
    try {
        console.log("📡 1. Lépés: Nagy mennyiségű adat lekérése...");
        
        // Lekérjük a Premier League meccseket
        const options = {
            method: 'GET',
            url: 'https://v3.football.api-sports.io/fixtures',
            params: {
                date: new Date().toISOString().split('T')[0],
                league: '39', // Premier League
                season: '2023'
            },
            headers: { 'x-apisports-key': SPORT_API_KEY }
        };

        let response = await axios.request(options);
        let matches = response.data.response;

        // Ha nincs elég angol meccs, hozzácsapjuk a Spanyolt is (hogy legyen miből válogatni)
        if (!matches || matches.length < 3) {
            console.log("⚠️ Kevés az angol meccs, hozzáadom a La Ligát...");
            options.params.league = '140'; // La Liga
            let resp2 = await axios.request(options);
            matches = matches.concat(resp2.data.response);
        }

        if (matches.length === 0) {
            return res.send("<h1>Ma nincs elég meccs egy kombi szelvényhez.</h1>");
        }

        // Kiválasztjuk az első 6 meccset elemzésre (hogy ne terheljük túl a tokent)
        const matchCandidates = matches.slice(0, 6).map(m => {
            return `${m.teams.home.name} vs ${m.teams.away.name}`;
        }).join(", ");

        console.log(`🤖 2. Lépés: AI Matematikus indítása. Vizsgált meccsek: ${matchCandidates}`);

        // --- A PROFI UTASÍTÁS (PROMPT) ---
        const prompt = `
            Te egy profi sportfogadási AI asszisztens vagy, matematikai alapokon.
            
            FELADAT: Állíts össze EGYETLEN kombinált szelvényt (accumulator) a mai napra.
            A cél: Hosszú távú, stabil profit (6-12 hónapos ciklus).
            
            MECCSEK LISTÁJA:
            ${matchCandidates}
            
            UTASÍTÁS:
            1. Válassz ki ebből a listából PONTOSAN 3 vagy 4 legbiztosabb mérkőzést.
            2. Mindegyikhez adj egy biztonsági tippet (pl. 1.5 gól felett, vagy dupla esély).
            3. Számold ki a szelvény várható eredő oddsát.
            4. Indoklásban említsd meg a matematikai valószínűséget és a hosszú távú profitot.
            
            VÁLASZ FORMÁTUM (Csak JSON lehet!):
            {
                "matches": "1. Meccs: Tipp | 2. Meccs: Tipp | 3. Meccs: Tipp",
                "odds": "Eredő odds (pl. 3.45)",
                "reasoning": "Írj egy motiváló elemzést arról, hogy ez a szelvény hogyan illeszkedik a havi profit tervbe."
            }
        `;

        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "gpt-3.5-turbo", // Vagy gpt-4, ha van kereted
        });

        // Válasz feldolgozása
        let content = completion.choices[0].message.content;
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();
        const aiResponse = JSON.parse(content);

        // Mentés az adatbázisba
        // A "match" mezőbe most bekerül a teljes szelvény tartalma
        const newTip = new Tip({
            date: new Date().toLocaleDateString('hu-HU'),
            match: "⚡ NAPI PROFIT SZELVÉNY (MIX)", // Ez jelenik meg nagy betűvel
            prediction: aiResponse.matches, // Itt vannak a meccsek felsorolva
            odds: aiResponse.odds,
            reasoning: aiResponse.reasoning,
            league: "AI Prémium Válogatás"
        });

        await newTip.save();
        console.log("✅ KOMBI SZELVÉNY GENERÁLVA!");

        res.redirect('/dashboard');

    } catch (error) {
        console.error("GENERÁLÁSI HIBA:", error);
        res.send(`<h1>Hiba történt</h1><p>${error.message}</p>`);
    }
});

// ADMIN PANEL
app.get('/admin', requireLogin, requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 });
    res.render('admin', { users });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server fut: ${PORT}`));