const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const app = express();

const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const BRAND_NAME = "Zsivány Róka"; 

// --- 50+ ZSIVÁNY ÜZENET (MOTIVÁCIÓ + VICCEK) ---
const FOX_QUOTES = [
    "FALKA FIGYELEM! Ma nem kérünk... Elveszünk! 🦊💰",
    "A buki a zsákmány, mi vagyunk a vadászok. 🎯",
    "A tőke a lőszer. Ne lövöldözz vaktában! 💣",
    "A statisztika nem hazudik. A bukméker igen. 📊",
    "Hideg fej, forró oddsok, tele zseb. Ez a Róka törvénye. 🦊",
    "Ne dolgozz a pénzért... Küldd el a pénzt dolgozni! 💸",
    "A kamatos kamat a világ nyolcadik csodája. Mi használjuk. 📈",
    "A türelem profitot terem, a kapkodás veszteséget. ⏳",
    "Miért sír a bukméker? Mert meglátta a Róka elemzését. 😂",
    "Tudod mi a különbség közted és a buki közt? Neked van AI segítséged. 🤖",
    "A szerencsejátékos reménykedik. A befektető számol. 📉",
    "Egy Róka sosem hibázik, csak néha teszteli a piacot. 😉",
    "A Falka nem ismer kegyelmet, csak profitot. 🐺",
    "A profit nem a cél, hanem a mellékterméke a jó mateknak. 💰",
    "Ülj le, dőlj hátra, és nézd, ahogy a gép dolgozik. 🦊",
    "Ma is egy nappal közelebb a pénzügyi szabadsághoz. 🚀",
    "A legjobb idő a tőkeépítésre tegnap volt. A második legjobb ma. 🔥",
    "Buksza tele, szív nyugodt. Róka-vibe. ✨",
    "Nem tippmixelünk. Vagyonkezelünk. 🏛️",
    "A bukmékernek nincs esélye a mesterséges intelligencia ellen. 🧠",
    "Kérdezték a Rókát, mi a titka. Azt mondta: Matek és semmi érzelem. 🦊",
    "A legdrágább dolog a világon a rossz megérzés. 💸",
    "Legyél te a vadász, ne a préda! 🎯",
    "A pénz nem boldogít? Próbáld meg a Róka tippjeivel! 😂",
    "Sokan próbálkoznak, kevesen maradnak állva. Mi maradunk. 🦊",
    "A jövő felhő alapú, a profitunk pedig kőkemény. ☁️💰",
    "Amíg ők alszanak, a Róka algoritmusa elemez. 🌙",
    "Nincs több vakrepülés. Csak precíziós találatok. 🎯",
    "A siker titka: ne nyúlj a tőkéhez, hagyd fialni! 📈",
    "Zsebben a lé, agyban a terv. 🧠💸",
    "A Róka nem eszik tyúkot, csak oddsokat. 🦊🍗",
    "Fegyelem nélkül nincs birodalom. 🏰",
    "Minden nyertes tipp egy tégla a váradhoz. 🧱",
    "A buki azt hitte, ma ő nyer. A Róka csak mosolygott. 😏",
    "A tőkeépítés nem sprint, hanem maraton. De mi gyorsan futunk! 🏃‍♂️💨",
    "AI a zsebben, profit a számlán. Ez a 2026-os stílus. 🤖",
    "Ne csak nézd, csináld! A Róka utat mutat. 🦊",
    "A legnagyobb kockázat az, ha nem kockáztatsz okosan. 🎲",
    "Tiszta lap, tiszta matek, tiszta profit. 📉",
    "A Falka ereje az összefogásban és az algoritmusban van. 🐺",
    "A bukik utálnak minket. Ez a legnagyobb elismerés. 🏆",
    "Napi egy tipp, a profitot bent tartja. 😉",
    "A gazdagság ott kezdődik, ahol a kapzsiság véget ér. 🧠",
    "Minden meccs egy lehetőség. Mi csak a legjobbakat vesszük el. 🦊",
    "A Róka nem kér elnézést a nyereségért. 💰",
    "Építs vagyont, ne csak bankrollt! 🏛️",
    "A szoftver nem alszik, nem fárad, nem téved. 🤖✨",
    "Csatlakozz a győztesekhez, maradj a Falkával! 🦊🤝",
    "A matek a közös nyelvünk. A profit a válaszunk. 📈",
    "Zsivány Róka: A sportfogadás evolúciója. 🦊🧬"
];

// --- MODELLEK ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date, default: null }, isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 }, currentBankroll: { type: Number, default: 0 },
    monthlyProfit: { type: Number, default: 0 } 
}));

const Tip = mongoose.models.Tip || mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String, matchTime: String, 
    status: { type: String, default: 'pending' }, isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }, isReal: { type: Boolean, default: false }
}));

const SystemSetting = mongoose.models.SystemSetting || mongoose.model('SystemSetting', new mongoose.Schema({
    strategyMode: { type: String, default: 'normal' } 
}));

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 RÓKA MOTOR V68 (ULTIMATE) - ONLINE`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const u = await User.findById(req.session.userId);
    if (u && (u.isAdmin || u.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'fox_v68_ultimate', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- ROBOT: FIXÁLT ELEMZÉS ÉS ÚJRAGENERÁLÁS ---
app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };

    try {
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        const matches = response.data.matches || [];
        let fixtures = matches.filter(m => m.status === 'TIMED');
        if (fixtures.length === 0) return res.redirect('/admin');

        const matchData = fixtures.slice(0, 25).map(m => `${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`).join("\n");

        const systemPrompt = `Te vagy a Zsivány Róka AI. Mód: ${settings.strategyMode.toUpperCase()}. 
        Válassz EGY 80%+ biztonságú meccset. 
        KÖTELEZŐ JSON: { "league":"", "match":"", "prediction":"", "odds":"", "reasoning":"MATEK NEKEM", "memberMessage":"DUMA A FALKÁNAK", "matchTime":"HH:mm" }`;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: matchData }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);

        // Csak akkor mentünk ha van érdemi adat
        if (result.prediction && result.odds) {
            await Tip.findOneAndUpdate(
                { date: targetDate }, 
                { ...result, date: targetDate, isPublished: false, isReal: true, status: 'pending' }, 
                { upsert: true }
            );
        }
    } catch (e) { console.error("ROBOT HIBA:", e); }
    res.redirect('/admin');
});

// --- BANKÁR: LOSS GOMB FIX ÉS KAMATOS KAMAT ---
app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    try {
        const { status } = req.body; 
        const tip = await Tip.findOne({ date: getDbDate() });
        const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
        if (!tip || tip.status !== 'pending') return res.redirect('/admin');

        let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
        const users = await User.find({ isAdmin: false });

        for (let u of users) {
            let currentBank = (u.currentBankroll && u.currentBankroll > 0) ? u.currentBankroll : u.startingCapital;
            if (currentBank > 0) {
                let stake = Math.round(currentBank * p);
                let profit = (status === 'win') ? Math.round(stake * (parseFloat(tip.odds) - 1)) : -stake;
                u.currentBankroll = currentBank + profit;
                u.monthlyProfit = (u.monthlyProfit || 0) + profit;
                await u.save();
            }
        }
        tip.status = status;
        await tip.save();
        res.redirect('/admin');
    } catch (err) { res.redirect('/admin'); }
});

// --- RÓKA AGYA CHAT ---
app.post('/admin/chat', checkAdmin, async (req, res) => {
    try {
        const { message } = req.body;
        const currentTip = await Tip.findOne({ date: getDbDate() });
        await new ChatMessage({ sender: 'Főnök', text: message }).save();

        const context = currentTip ? `Meccs: ${currentTip.match}, Tipp: ${currentTip.prediction}, Matek: ${currentTip.reasoning}` : "Nincs mai tipp.";
        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: "Te vagy a Zsivány Róka. A Főnökkel beszélsz. Kontextus: " + context },
                { role: "user", content: message }
            ]
        });

        const reply = aiRes.choices[0].message.content;
        await new ChatMessage({ sender: 'Róka', text: reply }).save();
        res.json({ reply });
    } catch(e) { res.json({ reply: "Hiba." }); }
});

// --- DASHBOARD ROUTE ---
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    
    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const bank = (user.currentBankroll && user.currentBankroll > 0) ? user.currentBankroll : user.startingCapital;

    res.render('dashboard', { 
        user, dailyTip, suggestedStake: Math.round(bank * p), userBank: bank, 
        strategyMode: settings.strategyMode, monthlyProfit: user.monthlyProfit || 0, 
        foxQuotes: FOX_QUOTES, ownerEmail: OWNER_EMAIL 
    });
});

// ALAPOK
app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(20);
    res.render('admin', { users, currentTip, chatHistory, strategyMode: settings.strategyMode, brandName: BRAND_NAME });
});

app.post('/admin/update-settings', checkAdmin, async (req, res) => { await SystemSetting.findOneAndUpdate({}, { strategyMode: req.body.mode }, { upsert: true }); res.redirect('/admin'); });
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });
app.post('/auth/login', async (req, res) => { const u = await User.findOne({ email: req.body.email.toLowerCase() }); if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); } else res.send("Hiba."); });
app.get('/login', (req, res) => res.render('login'));
app.get('/', (req, res) => res.render('index'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(process.env.PORT || 8080);