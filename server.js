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
// 🔑 KULCSOK
// ======================================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
const SPORT_API_KEY = process.env.SPORT_API_KEY; 

if (!OPENAI_API_KEY || !SPORT_API_KEY) {
    console.error("⚠️ HIBA: Nincsenek beállítva a kulcsok a Railway-en!");
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ======================================================

const dbURI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/skyhigh';
mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB SIKERESEN CSATLAKOZTATVA'))
    .catch(err => console.log('❌ FATÁLIS DB HIBA:', err));

app.use(express.json()); 
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
    if (!req.session.userId) return res.redirect('/login');
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.isAdmin) return res.redirect('/dashboard');
    next();
};

// --- ÚTVONALAK ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/regisztracio', (req, res) => res.render('register'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// AUTH
app.post('/auth/register', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.password, 10);
        await new User({ fullname: req.body.fullname, email: req.body.email, password: hashed }).save();
        res.redirect('/login');
    } catch (e) { res.send('Email foglalt.'); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user && await bcrypt.compare(req.body.password, user.password)){
        req.session.userId = user._id;
        req.session.isAdmin = (req.body.email === 'stylefaqu@gmail.com');
        res.redirect('/dashboard');
    } else { res.send('Hibás adatok'); }
});

// DASHBOARD
app.get('/dashboard', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    // Licenc lejárati ellenőrzés
    if (user.licenseExpires && new Date() > user.licenseExpires) {
        user.hasLicense = false;
        await user.save();
    }
    const todayTip = await Tip.findOne().sort({ createdAt: -1 });
    res.render('dashboard', { user, isAdmin: req.session.isAdmin, dailyTip: todayTip });
});

// FIZETÉS
app.get('/fizetes', requireLogin, (req, res) => res.render('pay'));

app.post('/pay/create-checkout-session', requireLogin, async (req, res) => {
    const { plan } = req.body;
    const user = await User.findById(req.session.userId);
    
    let days = 30; // Alapértelmezett
    if (plan === 'biannual') days = 180;
    if (plan === 'annual') days = 365;

    const expiry = new Date(); expiry.setDate(expiry.getDate() + days);
    
    user.hasLicense = true; 
    user.licenseExpires = expiry; 
    // Ha fizet, nullázzuk a korlátot, hogy tudjon beszélni
    user.freeMessagesCount = 0; 
    await user.save();

    res.render('pay_success', { plan: 'Licenc Aktiválva', date: expiry.toLocaleDateString() });
});

// ======================================================
// 🧠 PROFI AI ASSZISZTENS + BANK MENEDZSMENT
// ======================================================
app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const { message } = req.body;
        const user = await User.findById(req.session.userId);

        // --- 1. ESET: NINCS LICENC (KORLÁTOZÁS) ---
        if (!user.hasLicense) {
            // Ellenőrizzük, elért-e a limitet (2 üzenet)
            if (user.freeMessagesCount >= 2) {
                return res.json({ 
                    reply: "⛔ <strong>A DEMO KERETED LEJÁRT.</strong><br><br>Sajnálom, de a Skyhigh AI Quantum elemzései és a Bank Menedzsment szolgáltatás csak előfizetőknek elérhető.<br><br>A folytatáshoz aktiváld a licencet a 'Fizetés' menüpontban!" 
                });
            }

            // Ha még van kerete, növeljük a számlálót
            user.freeMessagesCount += 1;
            await user.save();

            // Sales Robot válaszol
            const salesPrompt = `
                NEVED: Skyhigh AI.
                CÉL: Értékesítés.
                HELYZET: A felhasználónak NINCS licence. Ez a(z) ${user.freeMessagesCount}. üzenete a 2-ből.
                UTASÍTÁS: Válaszolj neki röviden (max 2 mondat), de mindenképp tereld a fizetés felé.
                Mondd el neki, hogy a "Bank Menedzsment" funkcióval pontosan kiszámolnád neki a havi profitot, de ehhez elő kell fizetnie.
            `;
            
            const completion = await openai.chat.completions.create({
                messages: [{ role: "system", content: salesPrompt }, { role: "user", content: message }],
                model: "gpt-3.5-turbo",
            });
            return res.json({ reply: completion.choices[0].message.content });
        }

        // --- 2. ESET: VAN LICENC (PROFI BANK MENEDZSER) ---
        
        // Ha először ír licenc után, és nincs tőke beállítva
        if (user.startingCapital === 0 && !isNaN(message) && Number(message) > 1000) {
            user.startingCapital = Number(message);
            user.currentCapital = Number(message);
            await user.save();
            return res.json({ 
                reply: `✅ <strong>BANKROLL RÖGZÍTVE: ${user.startingCapital} HUF</strong><br><br>Elkészítettem a havi fix tervedet:<br>--------------------------<br>Kezdő tőke: ${user.startingCapital} Ft<br>Célprofit: +30%<br>Várható záró: ${Math.floor(user.startingCapital * 1.3)} Ft<br>Napi tétméret: A tőke 3-5%-a<br>--------------------------<br>Mostantól én vezetem a bankodat. Kövesd a napi 1 utasítást a jobb oldalon!` 
            });
        }

        const managerPrompt = `
            NEVED: Skyhigh AI (Quantum Bank Manager).
            TUDÁS: A felhasználó tőkéje: ${user.startingCapital} Ft.
            
            FELADAT:
            Te egy szigorú Bankroll Menedzser és Sportfogadó Asszisztens vagy.
            
            1. HA MÉG NINCS TŐKE: Kérd be tőle azonnal! "Mekkora tőkével indítjuk a hónapot?"
            2. HA VAN TŐKE: Kezeld a pénzét. 
               - Ha kérdez, válaszolj TÁBLÁZATOS vagy listás formában, ha pénzről van szó.
               - Számolj neki várható profitot.
               - Mindig hangsúlyozd: "A havi fix táblázatot tartani kell."
            
            STÍLUS: Profi, pénzügyi szakember, érzelemmentes.
            
            FONTOS: Ha tippet kér, irányítsd a Dashboard jobb oldalára ("A Napi Master Tipp ott van, azt játszd meg.").
        `;

        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: managerPrompt }, { role: "user", content: message }],
            model: "gpt-3.5-turbo",
        });

        res.json({ reply: completion.choices[0].message.content });

    } catch (error) {
        console.error("Chat hiba:", error);
        res.status(500).json({ reply: "Hiba a rendszerben." });
    }
});

// ======================================================
// ⚡ NAPI TIPPEK GENERÁLÁSA
// ======================================================
app.get('/admin/generate-tip', requireLogin, requireAdmin, async (req, res) => {
    try {
        // ... (Ez a rész változatlan, a sport API lekérdezés) ...
        // Egyszerűsítve a helytakarékosság miatt, de a tiéd maradjon a régi vagy másold be a korábbit!
        // A lényeg a CHAT logika volt fentebb.
        
        // Itt csak egy gyors generátor, hogy működjön a kód:
        const options = {
            method: 'GET',
            url: 'https://v3.football.api-sports.io/fixtures',
            params: { date: new Date().toISOString().split('T')[0], league: '39', season: '2023' },
            headers: { 'x-apisports-key': SPORT_API_KEY }
        };
        let matches = [];
        try { matches = (await axios.request(options)).data.response; } catch(e) {}
        
        if (!matches || matches.length < 1) return res.send("Nincs elég meccs.");

        const prompt = `Válassz 1-2 meccset. JSON: { "matches": "...", "odds": "...", "reasoning": "..." }`;
        const simpleList = matches.slice(0, 5).map(m => `${m.teams.home.name} vs ${m.teams.away.name}`).join("\n");
        
        const gpt = await openai.chat.completions.create({
            messages: [{ role: "system", content: prompt + "\n" + simpleList }],
            model: "gpt-3.5-turbo"
        });
        
        let content = gpt.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
        const aiResponse = JSON.parse(content);

        await new Tip({
            date: new Date().toLocaleDateString(),
            match: "🎯 AI QUANTUM PICK",
            prediction: aiResponse.matches,
            odds: aiResponse.odds,
            reasoning: aiResponse.reasoning,
            league: "AI Prémium"
        }).save();

        res.redirect('/dashboard');
    } catch (e) { res.send("Hiba: " + e.message); }
});

app.get('/admin', requireLogin, requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 });
    res.render('admin', { users });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server fut: ${PORT}`));