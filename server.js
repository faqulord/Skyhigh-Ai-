const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const app = express();

// --- FŐNÖK BEÁLLÍTÁSOK ---
const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const BRAND_NAME = "Zsivány Róka"; 

// --- RÓKA ARANYKÖPÉSEK (FUTÓ SZÖVEGHEZ) ---
// Ez jelenik meg a Dashboard tetején, folyamatosan pörögve
const FOX_QUOTES = [
    "A buki már sírva ébredt ma reggel... 🦊",
    "A tőke a fegyvered, a türelem a pajzsod!",
    "Ma fosztogatunk, nem kérdezünk. 💰",
    "A statisztika a gyengék mankója, nekünk a fegyverünk.",
    "Ne tippelj. Vadássz! 🎯",
    "A bankroll menedzsment nem játék, hanem törvény.",
    "A Róka mindent lát. A buki csak reménykedik.",
    "Hideg fej, forró oddsok, tele zseb.",
    "Ez nem szerencsejáték. Ez üzlet.",
    "Fix bankrobbantás folyamatban... ⏳",
    "Aki mer, az a Róka oldalán nyer.",
    "Befektető vagy, nem szerencsejátékos!"
];

// --- ADATBÁZIS MODELLEK ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 },
    currentBankroll: { type: Number, default: 0 },
    monthlyProfit: { type: Number, default: 0 } 
}));

const Tip = mongoose.models.Tip || mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String, matchTime: String, 
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }, isReal: { type: Boolean, default: false }
}));

const SystemSetting = mongoose.models.SystemSetting || mongoose.model('SystemSetting', new mongoose.Schema({
    strategyMode: { type: String, default: 'normal' } 
}));

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

// --- RENDSZER INDÍTÁS ---
const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 RÓKA MOTOR V36 (MASTER) - ONLINE`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- ADMIN VÉDELEM ---
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const u = await User.findById(req.session.userId);
    if (u && (u.isAdmin || u.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'fox_master_key_v36', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 óra
}));

// ==========================================
// 🚀 AZ ÚJ GENERÁCIÓS AI AGY (RUN ROBOT)
// ==========================================
app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();
    try {
        // 1. Meccsek lekérése
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        const matches = response.data.matches || [];
        
        // Csak a jövőbeli (TIMED) meccsek
        let fixtures = matches.filter(m => m.status === 'TIMED');
        
        if (fixtures.length === 0) { 
            console.log("Ma nincs meccs az API szerint."); 
            return res.redirect('/admin'); 
        }

        // Limitáljuk a listát a Top 20 legfontosabb meccsre, hogy ne zavarjuk össze az AI-t
        const matchData = fixtures.slice(0, 20).map(m => `${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`).join("\n");
        
        // 2. A "MESTERLÖVÉSZ" PROMPT (FEJLESZTETT!)
        // Itt mondjuk meg neki, hogy bármire fogadhat (Gólok, BTTS, stb.)
        const systemPrompt = `
            Te vagy a "Zsivány Róka", a világ legdörzsöltebb sportfogadási AI elemzője.
            A feladatod: Keress ÉRTÉKET (Value Bet) a mai kínálatban.
            
            SZABÁLYOK:
            1. NE ragadj le a győztesnél (1X2). Vizsgáld meg a **Gólszámokat (Over/Under)**, **Mindkét Csapat Lő Gólt (BTTS)**, **DNB**, **Dupla Esély** piacokat is!
            2. A cél a 70% feletti valószínűség, de az odds legyen minimum 1.50 - 2.10 között.
            3. Keress piaci hibákat (pl. buki alulbecsüli a gólokat).
            4. Válassz ki EGYETLEN "Nap Tutiját".
            
            Kimeneti JSON formátum:
            { 
                "league": "Liga neve", 
                "match": "Hazai vs Vendég", 
                "prediction": "A KONKRÉT TIPP (pl. 2.5 gól felett / Mindkét csapat lő gólt / Hazai DNB)", 
                "odds": "Becsült odds (pl. 1.75)", 
                "reasoning": "Tömör, szakmai indoklás (pl. 'Mindkét csapat támadó focit játszik, a védelem lyukas, a gólváltás 85% esélyű.')", 
                "matchTime": "HH:mm" 
            }
        `;

        // 3. Elemzés indítása
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: systemPrompt }, 
                { role: "user", content: `Itt a mai kínálat:\n${matchData}` }
            ],
            response_format: { type: "json_object" }
        });
        
        const result = JSON.parse(aiRes.choices[0].message.content);
        
        // 4. Marketing Szöveg Generálás (Róka Stílusban)
        const marketingRes = await openai.chat.completions.create({
             model: "gpt-4-turbo-preview",
             messages: [
                 { role: "system", content: "Te vagy a Zsivány Róka. Írj egy rövid, vicces, de tekintélyt parancsoló üzenetet a tagoknak ehhez a tipphez. Használj szlenget és emojikat. Érezzék, hogy ez a tuti." }, 
                 { role: "user", content: `Tipp: ${result.prediction}, Indoklás: ${result.reasoning}` }
             ] 
        });

        // 5. Mentés az adatbázisba
        await Tip.findOneAndUpdate({ date: targetDate }, { 
            ...result, 
            memberMessage: marketingRes.choices[0].message.content,
            date: targetDate, 
            isPublished: false, 
            isReal: true, 
            status: 'pending'
        }, { upsert: true });

    } catch (e) { console.error("AI Elemzési Hiba:", e); }
    
    res.redirect('/admin');
});

// ==========================================
// 🔗 ÚTVONALAK (ROUTOK)
// ==========================================

// DASHBOARD - Itt adjuk át a FOX_QUOTES-t!
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    
    // Bankár logika
    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const bank = user.currentBankroll || user.startingCapital || 0;
    
    res.render('dashboard', { 
        user, 
        dailyTip, 
        suggestedStake: Math.round(bank * p), 
        userBank: bank, 
        strategyMode: settings.strategyMode,
        monthlyProfit: user.monthlyProfit || 0,
        foxQuotes: FOX_QUOTES // <--- ÁTADJUK AZ ÜZENETEKET
    });
});

// STATISZTIKA
app.get('/stats', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const tips = await Tip.find({ date: { $gte: startOfMonth }, status: { $ne: 'pending' } }).sort({ date: -1 });
    
    let wins = tips.filter(t => t.status === 'win').length;
    let losses = tips.filter(t => t.status === 'loss').length;
    
    res.render('stats', { user, tips, wins, losses, monthlyProfit: user.monthlyProfit || 0 });
});

// ADMIN HQ
app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(20);
    res.render('admin', { users, currentTip, chatHistory, strategyMode: settings.strategyMode, brandName: BRAND_NAME });
});

// KIJELENTKEZÉS
app.get('/logout', (req, res) => {
    req.session.destroy(() => { res.redirect('/'); });
});

// LANDING PAGE (BELÉPÉS ELŐTT)
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));

// ==========================================
// 🛠️ FUNKCIÓK (ADMIN GOMBOK)
// ==========================================

// Beállítások (Stratégia)
app.post('/admin/update-settings', checkAdmin, async (req, res) => {
    await SystemSetting.findOneAndUpdate({}, { strategyMode: req.body.mode }, { upsert: true });
    res.redirect('/admin');
});

// Szöveg AI Finomítása
app.post('/admin/refine-text', checkAdmin, async (req, res) => {
    const tip = await Tip.findOne({ date: getDbDate() });
    if (!tip) return res.redirect('/admin');
    const refined = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{ role: "system", content: "Legyél még dörzsöltebb, rövidebb, szlengesebb!" }, { role: "user", content: tip.memberMessage }]
    });
    await Tip.findByIdAndUpdate(tip._id, { memberMessage: refined.choices[0].message.content });
    res.redirect('/admin');
});

// EREDMÉNY ELSZÁMOLÁSA (BANK + PROFIT FRISSÍTÉS)
app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const tip = await Tip.findOne({ date: getDbDate() });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    if (!tip || tip.status !== 'pending') return res.redirect('/admin');

    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const users = await User.find({ isAdmin: false });
    
    for (let u of users) {
        let b = u.currentBankroll || u.startingCapital || 0;
        // Csak akkor számolunk, ha van tőkéje
        if (b > 0) {
            let s = b * p; // Tét
            let profit = 0;

            if (req.body.status === 'win') {
                profit = s * (parseFloat(tip.odds) - 1);
                b += profit;
            } else {
                profit = -s;
                b -= s;
            }

            u.currentBankroll = Math.round(b);
            u.monthlyProfit = (u.monthlyProfit || 0) + Math.round(profit);
            await u.save();
        }
    }
    tip.status = req.body.status;
    await tip.save();
    res.redirect('/admin');
});

// HAVI NULLÁZÓ (TISZTA LAP)
app.post('/admin/reset-monthly', checkAdmin, async (req, res) => {
    await User.updateMany({}, { monthlyProfit: 0 });
    res.redirect('/admin');
});

// TIP PUBLIKÁLÁSA
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { 
    await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); 
    res.redirect('/admin'); 
});

// CHAT FUNKCIÓ
app.post('/admin/chat', checkAdmin, async (req, res) => {
    const { message } = req.body;
    await new ChatMessage({ sender: 'Főnök', text: message }).save();
    const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Rövid, strategikus, Róka stílusú válasz." }, { role: "user", content: message }] });
    const reply = aiRes.choices[0].message.content;
    await new ChatMessage({ sender: 'Róka', text: reply }).save();
    res.json({ reply });
});

// MARKETING GENERÁTOROK
app.post('/admin/social-content', checkAdmin, async (req, res) => {
    const prompt = req.body.type === 'win' ? "Írj egy agresszív, dicsekvő Instagram posztot, hogy bankot robbantottunk ma!" : "Írj egy motivációs posztot arról, hogy a türelem pénzt terem.";
    const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "user", content: prompt }] });
    res.json({ content: aiRes.choices[0].message.content });
});

app.post('/admin/draft-email', checkAdmin, async (req, res) => {
    const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Írj egy rövid, ütős hírlevelet." }, { role: "user", content: req.body.topic }] });
    res.json({ draft: aiRes.choices[0].message.content });
});

// USER BANK FRISSÍTÉS
app.post('/user/update-bank', async (req, res) => {
    const amount = parseInt(req.body.amount);
    if (!isNaN(amount)) await User.findByIdAndUpdate(req.session.userId, { startingCapital: amount, currentBankroll: amount });
    res.redirect('/dashboard');
});

// LOGIN AUTH
app.post('/auth/login', async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase() });
    if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); }
    else res.send("Hiba: Hibás jelszó vagy email!");
});

// SZERVER START
app.listen(process.env.PORT || 8080, () => console.log("🦊 RENDSZER ÉLES!"));