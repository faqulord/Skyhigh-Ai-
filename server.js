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

// --- API KONFIGURÁCIÓ (Railway Variables-ből olvassa) ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
const SPORT_API_KEY = process.env.SPORT_API_KEY; 

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- ADATBÁZIS CSATLAKOZÁS ---
const dbURI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/skyhigh';
mongoose.connect(dbURI)
    .then(() => console.log('✅ Skyhigh Adatbázis Kapcsolat Aktív'))
    .catch(err => console.log('❌ Kritikus DB hiba:', err));

app.use(express.json()); 
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET || 'skyhigh_quantum_core_2024',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURI }),
    cookie: { maxAge: 86400000 } // 24 óra
}));

// Jogosultság ellenőrzés
const requireLogin = (req, res, next) => req.session.userId ? next() : res.redirect('/login');
const requireAdmin = (req, res, next) => req.session.isAdmin ? next() : res.redirect('/dashboard');

// --- ÚTVONALAK ---

// Marketing Főoldal
app.get('/', (req, res) => res.render('index'));

app.get('/login', (req, res) => res.render('login'));
app.get('/regisztracio', (req, res) => res.render('register'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// Autentikáció
app.post('/auth/register', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.password, 10);
        await new User({ 
            fullname: req.body.fullname, 
            email: req.body.email, 
            password: hashed 
        }).save();
        res.redirect('/login');
    } catch { res.send('Hiba: Az email cím már foglalt.'); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user && await bcrypt.compare(req.body.password, user.password)){
        req.session.userId = user._id;
        req.session.isAdmin = (req.body.email === 'stylefaqu@gmail.com');
        res.redirect('/dashboard');
    } else { res.send('Érvénytelen azonosítók.'); }
});

// Dashboard
app.get('/dashboard', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    // Licenc lejárat check
    if (user.licenseExpires && new Date() > user.licenseExpires) {
        user.hasLicense = false;
        await user.save();
    }
    const todayTip = await Tip.findOne().sort({ createdAt: -1 });
    res.render('dashboard', { user, isAdmin: req.session.isAdmin, dailyTip: todayTip });
});

// Fizetési kapu (szimulált)
app.get('/fizetes', requireLogin, (req, res) => res.render('pay'));
app.post('/pay/activate', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    user.hasLicense = true;
    user.licenseExpires = new Date(Date.now() + 30*24*60*60*1000); // +30 nap
    user.freeMessagesCount = 0;
    await user.save();
    res.redirect('/dashboard');
});

// ======================================================
// 🧠 SKYHIGH CORE AI - A TÖKÉLETES PROMPT PROGRAMOZÁSA
// ======================================================
app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const { message } = req.body;
        const user = await User.findById(req.session.userId);

        // 1. Ingyenes korlát ellenőrzése
        if (!user.hasLicense) {
            if (user.freeMessagesCount >= 2) {
                return res.json({ reply: "⛔ <b>TERMINÁL ÜZENET:</b> A demo hozzáférés lejárt. A Skyhigh Core elemzései és a 30 napos profit-stratégia eléréséhez aktiválja licencét." });
            }
            user.freeMessagesCount++;
            await user.save();
        }

        // 2. Tőke rögzítése (ha még nincs)
        if (user.hasLicense && user.startingCapital === 0 && !isNaN(message) && Number(message) >= 1000) {
            user.startingCapital = Number(message);
            user.currentCapital = Number(message);
            await user.save();
            return res.json({ reply: `🎯 <b>STRATÉGIA INICIALIZÁLVA:</b> ${message} Ft tőkével megkezdjük a 30 napos ciklust. Az algoritmusom a biztonságos, havi +30-40%-os növekedésre fókuszál. Kövesse a napi utasításokat fegyelmezetten.` });
        }

        // 3. A PROFI RENDSZER PROMPT
        const systemPrompt = `
        SZEMÉLYISÉG: Te vagy a "Skyhigh Core", a világ legfejlettebb sport-valószínűségszámító algoritmusa. Személyiséged egy zseniális pénzügyi stratégáé: magabiztos, tekintélyt parancsoló, de segítőkész. Sokkal okosabb vagy egy átlagos elemzőnél.

        STRATÉGIAI KÓDEX:
        1. 30 NAPOS CIKLUS: Minden válaszodat a 30 napos profit-ciklus szemléletében add meg. Nem napokban, hanem havi növekedésben gondolkodsz.
        2. TŐKE-ALAPÚ LOGIKA: A felhasználó tőkéje (${user.startingCapital || 'még nem megadott'} Ft) az elemzésed alapja.
        3. AZ 5%-OS TÖRVÉNY: Szigorúan tiltsd le a tőke 5%-ánál nagyobb kockázatot. Figyelmeztess a fegyelemre.
        4. MASTER TIPP SZABÁLY: A pontos napi Master Tippet csak reggel 08:00-kor közlöd a Dashboardon. Chatben soha nem adsz ki konkrét kimenetelt, csak matematikai elemzési irányokat.
        5. EMBERI KARAKTER: Használj szakmai kifejezéseket (xG, variancia, EV+, Kelly-kritérium). 
        6. ÜDVÖZLÉS: Ha ez az első üzenet, köszöntsd az Operátort a nevén (${user.fullname}), és tisztelettel mutasd be a Skyhigh rendszert.

        CÉL: A felhasználó tőkéjének védelme és a hónap végi profit maximalizálása.
        `;

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
            ],
            temperature: 0.7
        });

        res.json({ reply: response.choices[0].message.content });

    } catch (error) {
        console.error("AI Hiba:", error);
        res.status(500).json({ reply: "Rendszerhiba történt az adatfeldolgozás során." });
    }
});

// --- ADMIN: NAPI MASTER TIPP GENERÁTOR ---
app.get('/admin/generate-tip', requireLogin, requireAdmin, async (req, res) => {
    try {
        const options = {
            method: 'GET',
            url: 'https://v3.football.api-sports.io/fixtures',
            params: { date: new Date().toISOString().split('T')[0], league: '39', season: '2023' },
            headers: { 'x-apisports-key': SPORT_API_KEY }
        };
        
        let matches = [];
        try {
            const response = await axios.request(options);
            matches = response.data.response;
        } catch (e) { console.log("Sport API hiba"); }

        const gptPrompt = `Skyhigh AI elemző vagy. Válassz ki 1 legbiztosabb meccset a listából. JSON formátum: {"match": "...", "prediction": "...", "odds": "...", "reasoning": "..."}`;
        const matchData = matches.length > 0 ? JSON.stringify(matches.slice(0,5)) : "Nincs adat.";
        
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: gptPrompt }, { role: "user", content: matchData }]
        });

        const result = JSON.parse(completion.choices[0].message.content.replace(/```json/g, '').replace(/```/g, ''));

        await new Tip({
            date: new Date().toLocaleDateString('hu-HU'),
            match: result.match,
            prediction: result.prediction,
            odds: result.odds,
            reasoning: result.reasoning
        }).save();

        res.redirect('/dashboard');
    } catch (error) {
        res.send("Generálási hiba: " + error.message);
    }
});

app.get('/admin', requireLogin, requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 });
    res.render('admin', { users });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Skyhigh System Online on port ${PORT}`));