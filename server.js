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
const FOX_QUOTES = [
    "FALKA FIGYELEM! Ma nem kérünk... Elveszünk! 🦊💰",
    "A buki a zsákmány, mi vagyunk a vadászok. Töltsd a puskát! 🎯",
    "Ez nem tippmixelés, ez befektetés. A tőke a lőszer! 💣",
    "Bárhol játszhatod, a matek mindenhol ugyanaz: A Ház mindig veszít ellenünk. 📉",
    "Ne dolgozz a pénzért... Küldd el a pénzt dolgozni a Róka tippjével! 💸",
    "A statisztika nem hazudik. A bukméker igen. Mi a mateknak hiszünk. 📊",
    "Hideg fej, forró oddsok, tele zseb. Ez a Róka törvénye. 🦊",
    "Amíg ők izgulnak, addig a mi pénzünk fial. 📈"
];

const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, 
    hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date, default: null },
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

const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 RÓKA MOTOR V55 (EXCLUSIVE) - ONLINE`));
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
    secret: 'fox_v55_exclusive', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- DASHBOARD (EXKLUZÍV TILTÓ KÉPERNYŐVEL) ---
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    
    if (user.email !== OWNER_EMAIL && !user.isAdmin) {
        // Lejárat ellenőrzés
        if (user.licenseExpiresAt && new Date() > new Date(user.licenseExpiresAt)) {
            user.hasLicense = false;
            await user.save();
        }
        
        // HA NINCS LICENSZ -> EXKLUZÍV ÜZENET
        if (!user.hasLicense) {
            return res.send(`
                <!DOCTYPE html>
                <html lang="hu">
                <head>
                    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Hozzáférés Megtagadva | Zsivány Róka</title>
                    <script src="https://cdn.tailwindcss.com"></script>
                    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@800&family=Inter:wght@400;700&display=swap" rel="stylesheet">
                    <style>body{background:#050505;color:#fff;font-family:'Inter',sans-serif;}</style>
                </head>
                <body class="p-6 flex flex-col items-center justify-center min-h-screen text-center">
                    
                    <div class="text-6xl mb-6">🔒</div>
                    <h1 class="text-xl font-black text-red-600 uppercase tracking-[0.2em] mb-8 font-orbitron">Rendszer Hozzáférés<br>Megtagadva</h1>

                    <div class="bg-[#111] p-8 rounded-3xl border border-zinc-800 max-w-sm w-full shadow-[0_0_30px_rgba(0,0,0,0.8)] mb-8 relative overflow-hidden">
                        <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-600 to-pink-600"></div>
                        <p class="text-sm font-bold text-white leading-relaxed uppercase tracking-wide">
                            Mesterséges felhő alapú<br>
                            <span class="text-purple-500">élő sportfogadási elemzés</span><br>
                            fix stratégiával.
                        </p>
                        <div class="mt-4 border-t border-zinc-800 pt-4">
                            <p class="text-[10px] text-zinc-500 font-mono">STATUS: <span class="text-red-500">INACTIVE</span></p>
                        </div>
                    </div>

                    <p class="text-xs text-zinc-600 mb-8 max-w-xs leading-relaxed">
                        Ez egy zárt rendszer. A belépéshez és az aktiváláshoz vedd fel a kapcsolatot a Tulajdonossal.
                    </p>

                    <a href="/logout" class="text-zinc-500 text-[10px] font-bold uppercase hover:text-white transition border border-zinc-800 px-6 py-3 rounded-full">Kijelentkezés</a>
                </body>
                </html>
            `);
        }
    }

    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03);
    const bank = user.currentBankroll || user.startingCapital || 0;

    res.render('dashboard', { 
        user, dailyTip, suggestedStake: Math.round(bank * p), userBank: bank, strategyMode: settings.strategyMode, 
        monthlyProfit: user.monthlyProfit || 0, foxQuotes: FOX_QUOTES, ownerEmail: OWNER_EMAIL 
    });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' };
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(20);
    res.render('admin', { users, currentTip, chatHistory, strategyMode: settings.strategyMode, brandName: BRAND_NAME });
});

// --- API FUNKCIÓK ---
app.post('/admin/manage-sub', checkAdmin, async (req, res) => {
    const { userId, action } = req.body;
    const u = await User.findById(userId);
    if (u) {
        if (action === 'add30') {
            let baseDate = (u.licenseExpiresAt && new Date(u.licenseExpiresAt) > new Date()) ? new Date(u.licenseExpiresAt) : new Date();
            baseDate.setDate(baseDate.getDate() + 30);
            u.licenseExpiresAt = baseDate;
            u.hasLicense = true;
        } else if (action === 'revoke') { u.hasLicense = false; }
        await u.save();
    } res.redirect('/admin');
});

app.post('/admin/social-content', checkAdmin, async (req, res) => {
    const prompt = req.body.type === 'win' 
        ? "Te vagy a Zsivány Róka. Írj egy dörzsölt, domináns Instagram posztot arról, hogy ma is kifosztottuk a bankot! Emojik: 🦊💰. Stílus: falka vezér." 
        : "Te vagy a Zsivány Róka. Írj egy posztot arról, hogy a sportfogadás nem játék, hanem üzlet.";
    try { const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "user", content: prompt }] }); res.json({ content: aiRes.choices[0].message.content }); } catch(e) { res.json({ content: "Hiba az AI-nál." }); }
});

app.post('/admin/draft-email', checkAdmin, async (req, res) => { try { const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Rövid hírlevél vázlat Zsivány Róka stílusban." }, { role: "user", content: req.body.topic }] }); res.json({ draft: aiRes.choices[0].message.content }); } catch(e) { res.json({ draft: "Hiba." }); } });

app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    const targetDate = getDbDate();
    const token = (process.env.SPORT_API_KEY || "").trim();
    try {
        const response = await axios.get(`https://api.football-data.org/v4/matches`, { headers: { 'X-Auth-Token': token } });
        const matches = response.data.matches || [];
        let fixtures = matches.filter(m => m.status === 'TIMED');
        if (fixtures.length === 0) return res.redirect('/admin');
        const matchData = fixtures.slice(0, 20).map(m => `${m.homeTeam.name} vs ${m.awayTeam.name} (${m.competition.name})`).join("\n");
        const systemPrompt = `Te vagy a Zsivány Róka. Keress 75%+ valószínűségű tippet (Gólok, 1X2, DNB). JSON: { "league":"", "match":"", "prediction":"", "odds":"", "reasoning":"", "matchTime":"HH:mm" }`;
        const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: matchData }], response_format: { type: "json_object" } });
        const result = JSON.parse(aiRes.choices[0].message.content);
        const marketingRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Rövid, dörzsölt üzenet a Falkának." }, { role: "user", content: `Tipp: ${result.prediction}` }] });
        await Tip.findOneAndUpdate({ date: targetDate }, { ...result, memberMessage: marketingRes.choices[0].message.content, date: targetDate, isPublished: false, isReal: true, status: 'pending' }, { upsert: true });
    } catch (e) { console.error(e); } res.redirect('/admin');
});

app.post('/admin/refine-text', checkAdmin, async (req, res) => { const tip = await Tip.findOne({ date: getDbDate() }); if (!tip) return res.redirect('/admin'); try { const refined = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Legyél rövidebb, dörzsöltebb!" }, { role: "user", content: tip.memberMessage }] }); await Tip.findByIdAndUpdate(tip._id, { memberMessage: refined.choices[0].message.content }); } catch(e) {} res.redirect('/admin'); });
app.post('/admin/settle-tip', checkAdmin, async (req, res) => { const tip = await Tip.findOne({ date: getDbDate() }); const settings = await SystemSetting.findOne({}) || { strategyMode: 'normal' }; if (!tip || tip.status !== 'pending') return res.redirect('/admin'); let p = settings.strategyMode === 'aggressive' ? 0.06 : (settings.strategyMode === 'recovery' ? 0.015 : 0.03); const users = await User.find({ isAdmin: false }); for (let u of users) { let b = u.currentBankroll || u.startingCapital || 0; if (b > 0) { let s = Math.round(b * p); let profit = req.body.status === 'win' ? Math.round(s * (parseFloat(tip.odds) - 1)) : -s; u.currentBankroll = b + profit; u.monthlyProfit = (u.monthlyProfit || 0) + profit; await u.save(); } } tip.status = req.body.status; await tip.save(); res.redirect('/admin'); });
app.post('/admin/update-settings', checkAdmin, async (req, res) => { await SystemSetting.findOneAndUpdate({}, { strategyMode: req.body.mode }, { upsert: true }); res.redirect('/admin'); });
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });
app.post('/admin/reset-monthly', checkAdmin, async (req, res) => { await User.updateMany({}, { monthlyProfit: 0 }); res.redirect('/admin'); });
app.post('/admin/chat', checkAdmin, async (req, res) => { try { const { message } = req.body; await new ChatMessage({ sender: 'Főnök', text: message }).save(); const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Rövid válasz." }, { role: "user", content: message }] }); await new ChatMessage({ sender: 'Róka', text: aiRes.choices[0].message.content }).save(); res.json({ reply: aiRes.choices[0].message.content }); } catch(e) { res.json({ reply: "Hiba." }); } });
app.post('/user/update-bank', async (req, res) => { const amount = parseInt(req.body.amount); if (!isNaN(amount)) await User.findByIdAndUpdate(req.session.userId, { startingCapital: amount, currentBankroll: amount }); res.redirect('/dashboard'); });
app.post('/auth/register', async (req, res) => { try { const { fullname, email, password } = req.body; const existing = await User.findOne({ email: email.toLowerCase() }); if (existing) return res.send("Ez az email már foglalt!"); const hashedPassword = await bcrypt.hash(password, 10); const newUser = await new User({ fullname, email: email.toLowerCase(), password: hashedPassword, hasLicense: false }).save(); req.session.userId = newUser._id; res.redirect('/dashboard'); } catch (e) { res.send("Hiba."); } });
app.post('/auth/login', async (req, res) => { const u = await User.findOne({ email: req.body.email.toLowerCase() }); if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); } else res.send("Hiba: Rossz adatok."); });
app.get('/register', (req, res) => res.render('register'));
app.get('/login', (req, res) => res.render('login'));
app.get('/terms', (req, res) => res.render('terms'));
app.get('/', (req, res) => res.render('index'));
app.get('/logout', (req, res) => { req.session.destroy(() => { res.redirect('/'); }); });
app.get('/stats', async (req, res) => { if (!req.session.userId) return res.redirect('/login'); const user = await User.findById(req.session.userId); const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]; const tips = await Tip.find({ date: { $gte: startOfMonth }, status: { $ne: 'pending' } }).sort({ date: -1 }); let wins = tips.filter(t => t.status === 'win').length; let losses = tips.filter(t => t.status === 'loss').length; res.render('stats', { user, tips, wins, losses, monthlyProfit: user.monthlyProfit || 0 }); });

app.listen(process.env.PORT || 8080);