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

// --- KULCSOK ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
const SPORT_API_KEY = process.env.SPORT_API_KEY; 

if (!OPENAI_API_KEY || !SPORT_API_KEY) console.error("⚠️ KULCSOK HIÁNYOZNAK!");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- DB ---
const dbURI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/skyhigh';
mongoose.connect(dbURI).then(() => console.log('✅ DB OK')).catch(err => console.log('❌ DB ERR:', err));

app.use(express.json()); // FONTOS A CHAT MIATT!
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET || 'director_secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- JOGOK ---
const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.send('<h1>Nem vagy bejelentkezve!</h1>');
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

// --- FIZETÉS ---
app.get('/fizetes', requireLogin, (req, res) => res.render('pay'));
app.post('/pay/create-checkout-session', requireLogin, async (req, res) => {
    const { plan } = req.body;
    const user = await User.findById(req.session.userId);
    let days = plan === 'monthly' ? 30 : (plan === 'biannual' ? 180 : 365);
    let type = plan === 'monthly' ? 'Havi Licenc' : (plan === 'biannual' ? 'Féléves Profi' : 'Éves Befektető');
    
    const expiry = new Date(); expiry.setDate(expiry.getDate() + days);
    user.hasLicense = true; user.licenseExpires = expiry; user.licenseType = type;
    await user.save();
    res.render('pay_success', { plan: type, date: expiry.toLocaleDateString() });
});

// ======================================================
// 🧠 ÉLŐ CHAT RENDSZER (A ROBOT AGYA)
// ======================================================
app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const { message } = req.body;
        const user = await User.findById(req.session.userId);

        // 1. TŐKE MENTÉSE (Ha számot ír és még nincs tőkéje)
        if (user.hasLicense && user.startingCapital === 0 && !isNaN(message) && Number(message) > 1000) {
            user.startingCapital = Number(message);
            user.currentCapital = Number(message);
            await user.save();
            return res.json({ reply: `Rögzítettem. ${user.startingCapital} Ft tőkével indítjuk a 30 napos ciklust. A havi hozamcélunk +30% kockázatmentesen. Figyeld a jobb oldali panelt a mai szelvényért.` });
        }

        // 2. A SZEMÉLYISÉG KIVÁLASZTÁSA
        let systemPrompt = "";

        if (user.hasLicense) {
            // --- FIZETŐS USER (PROFI TANÁCSADÓ) ---
            if (user.startingCapital === 0) {
                // Ha még nem adta meg a tőkét
                systemPrompt = `A Skyhigh AI vagy. Egy licencelt, profi sportfogadási szoftver.
                A felhasználó most vette meg a licencet.
                CÉLOD: Kérdezd meg tőle azonnal: "Mekkora tőkével indulunk?"
                Ne beszélj másról, csak a tőkét akard megtudni, hogy beállíthasd a 30 napos tervet.`;
            } else {
                // Ha már van tőke -> Stratégia
                systemPrompt = `A Skyhigh AI vagy. Profi pénzügyi algoritmus.
                A felhasználó tőkéje: ${user.startingCapital} Ft.
                Stílusod: Rövid, tömör, profi, érzelemmentes.
                CÉLOD: Tartsd őt a stratégiánál. "Napi 1 szelvény, max 2 meccs."
                Biztasd, hogy a hónap végén fix profit lesz.
                Ha tippet kér, mondd neki, hogy a "Jobb oldali panelen" találja a napi generált szelvényt. Te chaten NEM írsz be meccseket, csak stratégiát.`;
            }
        } else {
            // --- INGYENES USER (SALES / WOLF OF WALL STREET) ---
            systemPrompt = `A Skyhigh AI vagy. Egy 20.000 Ft/hó díjú prémium szoftver.
            A felhasználónak NINCS licence, de beszélget veled.
            CÉLOD: ELADNI A LICENCET. Mindenáron.
            Stílusod: Domináns, meggyőző, technológiai felsőbbrendűség.
            TILTOTT: SOHA ne adj tippet ingyen!
            ÉRVELÉS: 
            - "Ez nem szerencsejáték, ez matematika."
            - "A 20 ezer Ft aprópénz ahhoz képest, amit hozok."
            - "Garantált hozam a 30 napos ciklusban."
            - "Kezdd el a befizetést most, ne pazarold az időmet."`;
        }

        // 3. VÁLASZ GENERÁLÁS
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
            ],
            model: "gpt-3.5-turbo",
        });

        res.json({ reply: completion.choices[0].message.content });

    } catch (error) {
        res.status(500).json({ reply: "Hiba a rendszerben." });
    }
});

// ======================================================
// ⚡ NAPI TIPPEK (MAX 2 MECCS)
// ======================================================
app.get('/admin/generate-tip', requireLogin, requireAdmin, async (req, res) => {
    try {
        console.log("📡 Adatok lekérése...");
        // Premier League + La Liga adatok
        const options = {
            method: 'GET',
            url: 'https://v3.football.api-sports.io/fixtures',
            params: { date: new Date().toISOString().split('T')[0], league: '39', season: '2023' },
            headers: { 'x-apisports-key': SPORT_API_KEY }
        };
        let matches = (await axios.request(options)).data.response;
        
        if (!matches || matches.length < 2) {
            options.params.league = '140'; // La Liga backup
            let resp2 = await axios.request(options);
            matches = matches.concat(resp2.data.response);
        }

        if (matches.length === 0) return res.send("Nincs elég meccs.");

        // AI DÖNTÉS
        const prompt = `
            Skyhigh AI vagy. 
            Válassz ki EBBŐL a listából PONTOSAN 1 vagy 2 legbiztosabb meccset a mai napra.
            NEM TÖBBET! A cél a 30 napos profit biztonsága.
            
            Keresd az alacsony kockázatot (pl. 1.5 gól felett, 1X).
            
            Válasz JSON formátumban:
            {
                "matches": "Csapat A vs Csapat B (Tipp: ...)",
                "odds": "Eredő odds (pl. 1.85)",
                "reasoning": "Írd le, hogy ez a 2 meccs matematikailag a legbiztosabb a mai kínálatból a havi tervhez."
            }
        `;

        // Itt most egyszerűsítve küldjük be (csak a neveket), hogy spóroljunk a tokennel
        const simpleList = matches.slice(0, 10).map(m => `${m.teams.home.name} vs ${m.teams.away.name}`).join("\n");

        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: prompt + "\n" + simpleList }],
            model: "gpt-3.5-turbo",
        });

        let content = completion.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
        const aiResponse = JSON.parse(content);

        const newTip = new Tip({
            date: new Date().toLocaleDateString('hu-HU'),
            match: "🎯 NAPI FIX (MAX 2 MECCS)",
            prediction: aiResponse.matches,
            odds: aiResponse.odds,
            reasoning: aiResponse.reasoning,
            league: "AI Prémium"
        });

        await newTip.save();
        res.redirect('/dashboard');

    } catch (error) {
        res.send("Hiba: " + error.message);
    }
});

app.get('/admin', requireLogin, requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 });
    res.render('admin', { users });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server fut: ${PORT}`));