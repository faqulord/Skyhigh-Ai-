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
// 🔑 KULCSOK KEZELÉSE (BIZTONSÁGOS MÓD)
// ======================================================

// A kulcsokat a szerver környezetéből olvassuk ki, nem a fájlból!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
const SPORT_API_KEY = process.env.SPORT_API_KEY; 

// Ha nincsenek beállítva a kulcsok, szólunk a konzolon
if (!OPENAI_API_KEY) console.error("HIBA: Hiányzik az OPENAI_API_KEY!");
if (!SPORT_API_KEY) console.error("HIBA: Hiányzik a SPORT_API_KEY!");

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

// FIZETÉS
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

// AI GENERÁTOR (Biztonságos)
app.get('/admin/generate-tip', requireLogin, requireAdmin, async (req, res) => {
    try {
        console.log("📡 Adatok lekérése...");
        
        const options = {
            method: 'GET',
            url: 'https://v3.football.api-sports.io/fixtures',
            params: {
                date: new Date().toISOString().split('T')[0],
                league: '39', 
                season: '2023'
            },
            headers: {
                'x-apisports-key': SPORT_API_KEY // Most már a változóból jön
            }
        };

        const response = await axios.request(options);
        const matches = response.data.response;

        let game = null;
        let leagueName = "Premier League";

        if (matches && matches.length > 0) {
            game = matches[0];
        } else {
            console.log("⚠️ Nincs Premier League, nézem a La Ligát...");
            options.params.league = '140'; 
            const resp2 = await axios.request(options);
            if (resp2.data.response.length > 0) {
                game = resp2.data.response[0];
                leagueName = "La Liga";
            } else {
                return res.send("<h1>Ma nincs kiemelt meccs.</h1>");
            }
        }

        const matchTitle = `${game.teams.home.name} vs ${game.teams.away.name}`;
        
        const prompt = `
            Te egy profi sportfogadó AI vagy.
            Elemezd ezt a meccset: ${matchTitle} (${leagueName}).
            Adj egy rövid, nagyon biztos tippet JSON formátumban.
            Magyarul válaszolj!
            
            A JSON legyen pontosan ilyen:
            {
                "prediction": "Rövid tipp",
                "odds": "Becsült odds",
                "reasoning": "Indoklás (max 15 szó)."
            }
        `;

        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "gpt-3.5-turbo",
        });

        let content = completion.choices[0].message.content;
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();
        const aiResponse = JSON.parse(content);

        const newTip = new Tip({
            date: new Date().toLocaleDateString('hu-HU'),
            match: matchTitle,
            prediction: aiResponse.prediction,
            odds: aiResponse.odds,
            reasoning: aiResponse.reasoning,
            league: leagueName
        });

        await newTip.save();
        res.redirect('/dashboard');

    } catch (error) {
        console.error("GENERÁLÁSI HIBA:", error);
        res.send(`<h1>Hiba történt</h1><p>${error.message}</p>`);
    }
});

app.get('/admin', requireLogin, requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 });
    res.render('admin', { users });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server fut: ${PORT}`));