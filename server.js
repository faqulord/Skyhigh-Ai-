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

mongoose.connect(process.env.MONGO_URL).then(() => console.log("🚀 Rafinált Robot Róka ALMA v2.1 - PROFI ELEMZŐ MÓD"));

// --- ADATMODELLEK ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, reasoning: String,
    profitPercent: { type: Number, default: 0 }, matchTime: String, bookmaker: String,
    status: { type: String, default: 'pending' }, date: { type: String, index: true }
}));

const MonthlyStat = mongoose.model('MonthlyStat', new mongoose.Schema({
    month: String, totalProfit: { type: Number, default: 0 }, winCount: { type: Number, default: 0 }, totalTips: { type: Number, default: 0 }
}));

const ChatMessage = mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_alma_v28_friendly_fox',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getDbDate = () => new Date().toLocaleDateString('en-CA'); 

// --- ROBOT MOTOR (AZ AGY) ---
async function runAiRobot() {
    try {
        const dbDate = getDbDate();
        // 1. Adatok lekérése a Sport API-tól
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${dbDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY }
        });
        
        const now = new Date();
        // Szűrő: Csak olyan meccsek, amik minimum 3 óra múlva kezdődnek (hogy legyen idő fogadni)
        const fixtures = response.data.response.filter(f => (new Date(f.fixture.date) - now) > (3 * 60 * 60 * 1000));
        
        if (fixtures.length === 0) return false;

        // Kiválasztjuk a top 20 meccset elemzésre a listából
        const matchData = fixtures.slice(0, 20).map(f => 
            `Meccs: ${f.teams.home.name} vs ${f.teams.away.name} | Liga: ${f.league.name} | Kezdés: ${f.fixture.date}`
        ).join("\n");

        // 2. A "Ravasz Róka" Profi Prompt
        const systemPrompt = `
            Te vagy a "Ravasz Ai Róka", egy világszintű, matematikai alapú sportfogadási elemző asszisztens.
            A küldetésed: Hosszú távú tőkeépítés a felhasználóknak kamatos kamattal. Nem érdekelnek az érzelmek, csak a statisztika.
            
            FELADAT:
            Elemezd ki a kapott meccslistát, és válaszd ki a nap EGYETLEN LEGBIZTOSABB "Master Tippjét".
            
            SZABÁLYOK:
            1. Csak olyan tippet adj, aminek a matematikai valószínűsége meghaladja a 80%-ot.
            2. Kerüld a túl kockázatos fogadásokat. A cél a biztos lassú profit, nem a szerencsejáték.
            3. Az indoklásod legyen szakmai, részletes és statisztikai alapú (említs formát, motivációt).
            4. NYELV: KIZÁRÓLAG MAGYARUL VÁLASZOLJ!
            
            KIMENET (JSON formátum):
            {
                "league": "Liga neve",
                "match": "Hazai vs Vendég",
                "prediction": "A konkrét tipp (pl. Hazai győzelem vagy 2.5 gól felett)",
                "odds": "Becsült odds (pl. 1.50 - 1.80)",
                "reasoning": "Részletes, profi elemzés magyarul (min. 3 mondat). Magyarázd el, miért ez a nap legbiztosabb tippje.",
                "profitPercent": 5,
                "matchTime": "ÓÓ:PP",
                "bookmaker": "Bet365 / Unibet"
            }
        `;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview", // A legokosabb modell használata
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Itt vannak a mai elérhető mérkőzések (min. 3 óra múlva kezdődnek): \n${matchData}` }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        
        // Mentés az adatbázisba
        await Tip.findOneAndUpdate(
            { date: dbDate }, 
            { ...result, date: dbDate, status: 'pending' }, 
            { upsert: true }
        );

        await new ChatMessage({ 
            sender: 'Róka', 
            text: `🐺 A mai Master Tipp elkészült! A választásom: ${result.match}. A stratégia a biztos profitra épül.` 
        }).save();
        
        return true;
    } catch (e) { 
        console.error("AI Hiba:", e);
        return false; 
    }
}

// --- MIDDLEWARE ---
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- ÚTVONALAK ---

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    
    // Auto admin jog a tulajdonosnak
    if (user.email === OWNER_EMAIL) { user.isAdmin = true; user.hasLicense = true; await user.save(); }
    
    if (!user.hasLicense) return res.redirect('/pricing');
    if (user.startingCapital === 0) return res.render('set-capital', { user });

    const dailyTip = await Tip.findOne({ date: getDbDate() });
    
    // FRISSÍTÉS: Lekérjük az utolsó 10 lezárt tippet a táblázathoz (Win vagy Loss)
    const pastTips = await Tip.find({ status: { $in: ['win', 'loss'] } })
                              .sort({ date: -1 }) // Legfrissebb elől
                              .limit(10);

    const recommendedStake = Math.floor(user.startingCapital * 0.10); // 10% tétkezelés
    
    res.render('dashboard', { 
        user, 
        dailyTip, 
        pastTips, // Ezt küldjük át az új táblázathoz
        recommendedStake, 
        displayDate: new Date().toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' }), 
        nextTipText: (new Date().getHours() < 8) ? "Ma 08:00" : "Holnap 08:00" 
    });
});

app.get('/pricing', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    res.render('pricing', { user });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const stats = await MonthlyStat.find().sort({ month: -1 });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(30);
    
    const currentMonthPrefix = getDbDate().substring(0, 7);
    const monthlyTips = await Tip.find({ date: { $regex: new RegExp('^' + currentMonthPrefix) } }).sort({ date: 1 });
    
    let runningProfit = 0;
    const calculatorData = monthlyTips.map(t => {
        let dailyRes = (t.status === 'win') ? parseFloat(t.profitPercent) : (t.status === 'loss' ? -10 : 0);
        runningProfit += dailyRes;
        return { date: t.date, match: t.match, status: t.status, dailyProfit: dailyRes, totalRunning: runningProfit };
    });
    
    res.render('admin', { users, currentTip, stats, calculatorData, chatHistory, dbDate: getDbDate(), tipExists: !!currentTip, currentMonthName: new Date().toLocaleDateString('hu-HU', { month: 'long', year: 'numeric' }) });
});

app.post('/admin/chat', checkAdmin, async (req, res) => {
    await new ChatMessage({ sender: 'Admin', text: req.body.message }).save();
    // Itt is frissítettem a promptot, hogy csevegés közben is Róka maradjon
    const aiRes = await openai.chat.completions.create({ 
        model: "gpt-4-turbo-preview", 
        messages: [
            { role: "system", content: "Te vagy a Ravasz Ai Róka sportfogadó. Profi, lényegretörő és magyarul válaszolsz." }, 
            { role: "user", content: req.body.message }
        ] 
    });
    const reply = aiRes.choices[0].message.content;
    await new ChatMessage({ sender: 'Róka', text: reply }).save();
    res.json({ reply });
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    req.setTimeout(180000); 
    await runAiRobot();
    res.redirect('/admin');
});

app.post('/admin/activate-user', checkAdmin, async (req, res) => {
    await User.findByIdAndUpdate(req.body.userId, { hasLicense: true });
    res.redirect('/admin');
});

app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const { tipId, status } = req.body;
    const tip = await Tip.findById(tipId);
    
    // Csak akkor módosítjuk a statisztikát, ha változik az állapot
    if (tip.status !== status) {
        tip.status = status; 
        await tip.save();
        
        const month = tip.date.substring(0, 7);
        let ms = await MonthlyStat.findOne({ month }) || new MonthlyStat({ month });
        
        // Újrakalkulálás egyszerűsítve (csak hozzáadunk/levonunk)
        // Megjegyzés: Ha profibb statisztikát akarsz később, itt kell majd finomítani.
        ms.totalTips += 1;
        if (status === 'win') { 
            ms.winCount += 1; 
            ms.totalProfit += tip.profitPercent; 
        } else if (status === 'loss') { 
            ms.totalProfit -= 10; // Feltételezve 10% tétvesztés
        }
        await ms.save();
    }
    res.redirect('/admin');
});

// --- USER AUTHENTICATION ---
app.post('/auth/register', async (req, res) => {
    if (!req.body.terms) return res.send("El kell fogadnod az ÁSZF-et!");
    const hashed = await bcrypt.hash(req.body.password, 10);
    try {
        const user = await new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashed }).save();
        req.session.userId = user._id; res.redirect('/pricing');
    } catch(e) { res.send("Ez az email már regisztrálva van."); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id; req.session.save(() => res.redirect('/dashboard'));
    } else res.send("Hibás email vagy jelszó!");
});

app.post('/user/set-capital', async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital });
    res.redirect('/dashboard');
});

app.get('/terms', (req, res) => res.render('terms'));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/', (req, res) => res.render('index'));
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.listen(process.env.PORT || 8080, () => console.log("Server running..."));