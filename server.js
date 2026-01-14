const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const nodemailer = require('nodemailer');
const https = require('https');
const path = require('path');
const app = express();

const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const BRAND_NAME = "Zsivány Róka"; 

// --- RÓKA DUMÁK ---
const foxQuotes = [
    "📞 Hallod Főnök? A bukméker már remeg, ha meglátja a logónkat! 🦊💦",
    "🍗 Ma este nem vacsorázunk... ma este LAKOMÁZUNK a buki pénzéből!",
    "🥷 Hozd a símaszkot, a mai meccsek őrizetlenül hagyták a kasszát!",
    "💼 Nem szerencsejátékosok vagyunk. Mi 'Vagyon-Átcsoportosító Szakemberek' vagyunk.",
    "📞 Már hívtak a bankból... kérdezték, honnan jön ez a sok utalás. Mondtam: A Rókától!",
    "🏎️ A szomszédod dolgozni megy. Te meg profitot termelni. Nem vagytok egyformák.",
    "🤫 Pszt! A buki azt hiszi, ma pihenünk... MEKKORA TÉVEDÉS! Támadunk!",
    "🏹 Olyan vagyok, mint Robin Hood, csak én nem osztom szét, hanem megtartjuk magunknak! 😂",
    "🍕 Rendeld meg a pizzát Főnök, a számlát a fogadóirodára írasd!",
    "🔓 Az oddsok ma olyanok, mint a nyitott széfajtó. Bűn lenne kihagyni!",
    "😎 Nyugi, a matekot én intézem. Te csak készítsd a talicskát a lóvéhoz.",
    "💰 A pénznek nincs szaga... de a bukméker félelmének van! Érzed?",
    "🏦 Ma este bankrablás lesz, de legálisan. Imádom ezt a melót!",
    "📉 Amíg mások a veszteségeiket számolják, mi az új autót tervezgetjük.",
    "🦊 A Róka nem alszik. A Róka figyeli az oddsokat, amíg te pihensz.",
    "🥂 Bontsd a pezsgőt, Főnök! A mai elemzés tűzforró lett! 🔥",
    "🥊 Balhorog a bukinak, jobbegyenes a profitnak. K.O.!",
    "🧠 Az ész a legveszélyesebb fegyver. És mi állig fel vagyunk fegyverkezve.",
    "🛑 1.50-es odds? Ne nevettess. Mi a nagyvadra megyünk!",
    "🚜 Kellene egy nagyobb pénztárca... vagy inkább egy teherautó?",
    "💎 Gyémánt kezek, Főnök! A türelem mindig kifizetődik.",
    "👀 Látom a mátrixot. A számok zöldben úsznak. Csatlakozz!",
    "📜 A Falka törvénye: Egy mindenkiért, mindenki a PROFIÉRT!",
    "🚀 Nem a Holdra megyünk... hanem a Bankba! Gyere, szállj be!",
    "🦁 Az oroszlán a dzsungel királya, de a Róka fosztja ki a kaszinót.",
    "💸 Ma visszavesszük kamatostul azt, amit a múltkor elvittek!",
    "🕶️ Vedd fel a napszemüveget, Főnök! Vakítani fog a profit.",
    "🚪 Hagyd kint az érzelmeket. Itt bent csak a hideg logika uralkodik.",
    "⚡ Villámgyorsan lecsapunk, aztán eltűnünk a zsákmánnyal. Ez a stílusunk.",
    "📅 Új nap, új lehetőség, új bankrablás. Készen állsz?",
    "🔥 A mai tipp nem meleg... ez LÁNGOL! Égni fog a fogadóiroda!",
    "💶 Azt mondják, a pénz nem boldogít. De a nyertes szelvény igen!",
    "🏃‍♂️ Fussanak a vesztesek. Mi sétálunk a kasszához.",
    "🤝 Te + Én + Matek = A Bukméker Rémálma.",
    "🧘‍♂️ Nyugi. A Róka mindent lát. Bízz a rendszerben.",
    "🎯 Célkeresztben a profit. Tűzparancs kiadva!",
    "🎩 Ma este úriemberek leszünk... miután kifosztottuk őket.",
    "🧱 Tégláról téglára építjük a birodalmat. Ma lerakjuk a következőt.",
    "🚢 Mindenki a fedélzetre! A Profit Expressz most indul!",
    "👑 Ne elégedj meg az apróval. Te a Falka tagja vagy. Neked a trón jár!"
];

// --- FÜGGVÉNYEK ---
async function calculateStreak() {
    try {
        if (!mongoose.models.Tip) return 0;
        const tips = await mongoose.model('Tip').find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(10);
        let streak = 0;
        for (let tip of tips) { if (tip.status === 'win') streak++; else break; }
        return streak;
    } catch (e) { console.log("Streak hiba:", e.message); return 0; }
}

async function logToChat(sender, message) {
    if (!mongoose.models.ChatMessage) return;
    const now = new Date();
    const timeStr = now.toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });
    await new mongoose.model('ChatMessage')({ sender, text: `[${timeStr}] ${message}` }).save();
}

// --- CSATLAKOZÁS ---
mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log(`🚀 ${BRAND_NAME} System Ready - v29 MARKETING FIX`))
    .catch(err => console.error("MongoDB Hiba:", err));

// MODELLEK
const UserSchema = new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, 
    hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date }, 
    isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 }
});
const User = mongoose.models.User || mongoose.model('User', UserSchema);

const TipSchema = new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String,
    profitPercent: { type: Number, default: 0 }, matchTime: String, matchDate: String, bookmaker: String,
    recommendedStake: { type: String, default: "3%" },
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true },
    isReal: { type: Boolean, default: false }
});
const Tip = mongoose.models.Tip || mongoose.model('Tip', TipSchema);

const MonthlyStatSchema = new mongoose.Schema({
    month: String, totalProfit: { type: Number, default: 0 }, winCount: { type: Number, default: 0 }, 
    lossCount: { type: Number, default: 0 }, totalTips: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: false }
});
const MonthlyStat = mongoose.models.MonthlyStat || mongoose.model('MonthlyStat', MonthlyStatSchema);

const ChatMessageSchema = new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
});
const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', ChatMessageSchema);

// EMAIL KÜLDŐ
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER || OWNER_EMAIL, pass: process.env.EMAIL_PASS }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_boss_system_secret_v29',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getDbDate = () => new Date().toLocaleDateString('en-CA'); 

// --- AI MOTOR (DÁTUM KIÍRATÁSSAL) ---
async function runAiRobot() {
    await ChatMessage.deleteMany({});
    const targetDate = getDbDate();
    
    const m = new Date().toLocaleDateString('en-CA').substring(0, 7);
    const stat = await MonthlyStat.findOne({ month: m }) || { totalProfit: 0 };
    let strategyMode = "NORMAL";
    let stakeAdvice = "3%";
    if (stat.totalProfit >= 30) { strategyMode = "DEFENSIVE"; stakeAdvice = "1-2%"; }
    else if (stat.totalProfit < -10) { strategyMode = "RECOVERY"; stakeAdvice = "2%"; }

    await logToChat('Róka', `📊 Mód: ${strategyMode} | Tét: ${stakeAdvice}`);

    let isRealData = false;
    let validFixtures = [];
    
    try {
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${targetDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY, 'x-apisports-host': 'v3.football.api-sports.io' },
            httpsAgent: httpsAgent
        });

        let fixtures = response.data.response || [];
        const now = new Date();
        const threeHoursLater = new Date(now.getTime() + (3 * 60 * 60 * 1000)); 

        if (fixtures.length > 0) {
            validFixtures = fixtures.filter(f => {
                const matchDate = new Date(f.fixture.date);
                const hunTimeStr = matchDate.toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', hour12: false });
                const hunHour = parseInt(hunTimeStr.split(':')[0]); 
                return matchDate > threeHoursLater && hunHour >= 16;
            });
        }

        if (validFixtures.length > 0) isRealData = true;
        else validFixtures = [{ fixture: { date: targetDate + "T21:00:00", id: 999 }, league: { name: "Bajnokok Ligája (SZIMULÁCIÓ)" }, teams: { home: { name: "Liverpool" }, away: { name: "Real Madrid" } } }];

        // Meccsek listázása az AI-nak
        const matchData = validFixtures.slice(0, 40).map(f => {
            const time = new Date(f.fixture.date).toLocaleTimeString('hu-HU', {timeZone:'Europe/Budapest', hour:'2-digit', minute:'2-digit'});
            return `[${time}] ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`;
        }).join("\n");

        const analysisPrompt = `SZEREP: Profi Sportfogadó Stratéga. ADAT: ${isRealData ? "VALÓS" : "SZIMULÁCIÓ"} MÓD: ${strategyMode} FELADAT: Válassz meccset. FORMAT (JSON): { "league": "...", "match": "Hazai - Vendég", "prediction": "Tipp", "odds": "1.XX", "reasoning": "...", "profitPercent": 5, "matchTime": "ÓÓ:PP", "matchDate": "YYYY.MM.DD", "bookmaker": "...", "stake": "${stakeAdvice}" }`;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: analysisPrompt }, { role: "user", content: `Kínálat:\n${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        
        // --- JAVÍTOTT MARKETING PROMPT (DÁTUMMAL!) ---
        const marketingPrompt = `
            Eredeti elemzés: "${result.reasoning}" 
            Meccs: ${result.match}
            Időpont: ${result.matchTime}
            
            FELADAT: Írd át "Zsivány Róka" stílusban a tagoknak.
            FONTOS: A szöveg kezdődjön a pontos dátummal és időponttal! (Pl: "📅 MA 21:00 - ...")
            Legyen vicces, magabiztos, használj emojikat.
        `;
        
        const marketingRes = await openai.chat.completions.create({
             model: "gpt-4-turbo-preview",
             messages: [{ role: "system", content: "Creative Copywriter." }, { role: "user", content: marketingPrompt }] 
        });

        await Tip.findOneAndUpdate({ date: getDbDate() }, { 
            ...result, 
            memberMessage: marketingRes.choices[0].message.content,
            recommendedStake: result.stake, 
            date: getDbDate(), 
            status: 'pending', 
            isPublished: false,
            isReal: isRealData
        }, { upsert: true });

        await logToChat('Róka', `✅ **TIPP KIVÁLASZTVA**: ${result.match}`);
        return true;

    } catch (e) {
        console.error("HIBA:", e);
        await logToChat('System', `⚠️ Hiba: ${e.message}`);
        return false;
    }
}

// --- ÚTVONALAK ---
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    
    if (user.email === OWNER_EMAIL) { user.isAdmin = true; user.hasLicense = true; await user.save(); }
    
    // Auto-Kick (Lejárat)
    if (user.hasLicense && user.licenseExpiresAt && new Date() > new Date(user.licenseExpiresAt)) {
        user.hasLicense = false; 
        await user.save();
        return res.redirect('/pricing');
    }

    if (!user.hasLicense) return res.redirect('/pricing');
    if (user.startingCapital === 0) return res.render('set-capital', { user });

    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const recommendedStake = Math.floor(user.startingCapital * 0.10);
    const streak = await calculateStreak();
    
    res.render('dashboard', { 
        user, dailyTip, recommendedStake, 
        displayDate: new Date().toLocaleDateString('hu-HU'), 
        foxQuotes, streak 
    });
});

app.get('/stats', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const monthlyStats = await MonthlyStat.find({ isPublished: true }).sort({ month: -1 }) || [];
    const historyTips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(30) || [];
    res.render('stats', { user, monthlyStats, historyTips, randomQuote: "Statisztika" });
});

app.get('/pricing', (req, res) => res.render('pricing'));
app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(50);
    res.render('admin', { users, currentTip, recentTips: [], stats: [], chatHistory: [], calculatorData: [], dbDate: getDbDate(), brandName: BRAND_NAME });
});

app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });
app.post('/admin/delete-today', checkAdmin, async (req, res) => { await Tip.findOneAndDelete({ date: getDbDate() }); res.redirect('/admin'); });
app.post('/admin/run-robot', checkAdmin, async (req, res) => { req.setTimeout(300000); await runAiRobot(); res.redirect('/admin'); });

// --- MARKETING & EMAIL ÚTVONALAK (VISSZARAKVA!) ---
app.post('/admin/social-content', checkAdmin, async (req, res) => {
    try {
        const tip = await Tip.findOne({ date: getDbDate() });
        const type = req.body.type; // 'win' vagy 'motivation'
        
        const prompt = type === 'win' 
            ? `Írj egy nagyon rövid, emojikkal teli Instagram sztori szöveget erről a nyereményről: ${tip ? tip.match : 'Mai Profit'}! Legyen benne, hogy a Zsivány Róka megint hozta a pénzt!`
            : `Írj egy rövid, ütős motivációs üzenetet sportfogadóknak. Zsivány stílus.`;

        const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Social Media Manager" }, { role: "user", content: prompt }] });
        res.json({ content: aiRes.choices[0].message.content });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/draft-email', checkAdmin, async (req, res) => {
    try {
        const prompt = `Írj egy hírlevél vázlatot erről a témáról: "${req.body.topic}". Stílus: Zsivány Róka. Legyen rövid, figyelemfelkeltő. Formátum: Tárgy: [tárgy]\n\n[szöveg]`;
        const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Email Marketer" }, { role: "user", content: prompt }] });
        res.json({ draft: aiRes.choices[0].message.content });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/send-email', checkAdmin, async (req, res) => {
    try {
        const users = await User.find({ hasLicense: true }); // Csak aktív tagoknak
        const emails = users.map(u => u.email);
        
        await transporter.sendMail({
            from: `"Zsivány Róka" <${process.env.EMAIL_USER || OWNER_EMAIL}>`,
            bcc: emails, // Titkos másolat, hogy ne lássák egymást
            subject: req.body.subject,
            text: req.body.messageBody
        });
        await logToChat('System', `📧 Hírlevél elküldve ${emails.length} tagnak.`);
        res.redirect('/admin');
    } catch(e) { console.error(e); res.redirect('/admin'); }
});

app.post('/admin/send-test-email', checkAdmin, async (req, res) => {
    try {
        await transporter.sendMail({
            from: `"Zsivány Róka" <${process.env.EMAIL_USER || OWNER_EMAIL}>`,
            to: OWNER_EMAIL,
            subject: `[TESZT] ${req.body.subject}`,
            text: req.body.messageBody
        });
        await logToChat('System', `🧪 Teszt email elküldve neked.`);
        res.redirect('/admin');
    } catch(e) { console.error(e); res.redirect('/admin'); }
});

// SZÖVEG JAVÍTÁSA (Rövidítés + Időpont)
app.post('/admin/refine-text', checkAdmin, async (req, res) => {
    try {
        const tip = await Tip.findById(req.body.tipId);
        if(!tip) return res.redirect('/admin');
        const refinePrompt = `
            Eredeti szöveg: "${tip.memberMessage}"
            Időpont: ${tip.matchTime}
            
            FELADAT: Írd át "Zsivány Róka" stílusban, RÖVIDEN.
            FONTOS: A szöveg kezdődjön a meccs időpontjával! (Pl: "⏰ 21:00 - ...")
        `;
        const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Profi Marketing Copywriter." }, { role: "user", content: refinePrompt }] });
        tip.memberMessage = aiRes.choices[0].message.content;
        await tip.save();
        await logToChat('System', '📝 Szöveg javítva!');
        res.redirect('/admin');
    } catch(e) { console.error(e); res.redirect('/admin'); }
});

app.post('/admin/chat', checkAdmin, async (req, res) => { await logToChat('Főnök', req.body.message); const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Róka." }, { role: "user", content: req.body.message }] }); await logToChat('Róka', aiRes.choices[0].message.content); res.json({ reply: aiRes.choices[0].message.content }); });
app.post('/admin/settle-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { status: req.body.status }); res.redirect('/admin'); });

// AKTIVÁLÁS
app.post('/admin/activate-user', checkAdmin, async (req, res) => {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30); 
    await User.findByIdAndUpdate(req.body.userId, { hasLicense: true, licenseExpiresAt: expiryDate });
    res.redirect('/admin');
});

// AUTH
app.post('/auth/register', async (req, res) => { if(!req.body.terms)return res.send("Hiba"); const h=await bcrypt.hash(req.body.password,10); try{const u=await new User({fullname:req.body.fullname,email:req.body.email.toLowerCase(),password:h}).save();req.session.userId=u._id;res.redirect('/pricing');}catch(e){res.send("Email foglalt");} });
app.post('/auth/login', async (req, res) => { const u=await User.findOne({email:req.body.email.toLowerCase()}); if(u&&await bcrypt.compare(req.body.password,u.password)){req.session.userId=u._id;res.redirect('/dashboard');}else res.send("Hiba"); });
app.post('/user/set-capital', async (req, res) => { await User.findByIdAndUpdate(req.session.userId, {startingCapital:req.body.capital}); res.redirect('/dashboard'); });
app.get('/terms', (req, res) => res.render('terms')); app.get('/login', (req, res) => res.render('login')); app.get('/register', (req, res) => res.render('register')); app.get('/', (req, res) => res.render('index')); app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.listen(process.env.PORT || 8080);