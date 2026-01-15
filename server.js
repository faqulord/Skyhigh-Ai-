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

// --- RÓKA DUMÁK (VÁLTOZATLAN) ---
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

// --- MODELLEK ---
const UserSchema = new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date }, isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 }
});
const User = mongoose.models.User || mongoose.model('User', UserSchema);

const TipSchema = new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String,
    profitPercent: { type: Number, default: 0 }, matchTime: String, matchDate: String, bookmaker: String,
    recommendedStake: { type: String, default: "3%" },
    status: { type: String, default: 'pending' }, isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }, isReal: { type: Boolean, default: false }
});
const Tip = mongoose.models.Tip || mongoose.model('Tip', TipSchema);

const MonthlyStatSchema = new mongoose.Schema({
    month: String, totalProfit: { type: Number, default: 0 }, winCount: { type: Number, default: 0 }, 
    lossCount: { type: Number, default: 0 }, totalTips: { type: Number, default: 0 }, isPublished: { type: Boolean, default: false }
});
const MonthlyStat = mongoose.models.MonthlyStat || mongoose.model('MonthlyStat', MonthlyStatSchema);

const ChatMessageSchema = new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
});
const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', ChatMessageSchema);

// --- SEGÉDFÜGGVÉNYEK ---
// Pontos budapesti dátum kinyerése
const getDbDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' }); 

async function calculateStreak() {
    try {
        const tips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(10);
        let streak = 0;
        for (let tip of tips) { if (tip.status === 'win') streak++; else break; }
        return streak;
    } catch (e) { return 0; }
}

async function logToChat(sender, message) {
    const now = new Date();
    const timeStr = now.toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });
    await new ChatMessage({ sender, text: `[${timeStr}] ${message}` }).save();
}

// --- CSATLAKOZÁS ---
mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 ${BRAND_NAME} System Ready`));

const transporter = nodemailer.createTransport({
    service: 'gmail', auth: { user: process.env.EMAIL_USER || OWNER_EMAIL, pass: process.env.EMAIL_PASS }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_boss_system_secret_v29', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- RÓKA ELEMZÉS (MAXIMÁLIS PONTOSSÁGGAL) ---
async function runAiRobot() {
    await ChatMessage.deleteMany({});
    const targetDate = getDbDate();

    const m = targetDate.substring(0, 7);
    const stat = await MonthlyStat.findOne({ month: m }) || { totalProfit: 0 };
    let strategyMode = "NORMAL";
    let stakeAdvice = "3%";
    if (stat.totalProfit >= 30) { strategyMode = "DEFENSIVE"; stakeAdvice = "1-2%"; }
    else if (stat.totalProfit < -10) { strategyMode = "RECOVERY"; stakeAdvice = "2%"; }

    await logToChat('Róka', `📊 Mód: ${strategyMode} | Tét: ${stakeAdvice} | Cél: Havi Profit`);

    let isRealData = false;
    let validFixtures = [];

    try {
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${targetDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY, 'x-apisports-host': 'v3.football.api-sports.io' }
        });

        let fixtures = response.data.response || [];
        await logToChat('System', `📡 API válasz: ${fixtures.length} meccs érkezett.`);

        if (fixtures.length > 0) {
            validFixtures = fixtures.filter(f => {
                const matchDate = new Date(f.fixture.date);
                const hunHour = parseInt(matchDate.toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', hour12: false }));
                // SZŰRÉS: 13:00 ÉS ÉJFÉL KÖZÖTT
                return hunHour >= 13 && hunHour <= 23;
            });
        }

        if (validFixtures.length > 0) {
            isRealData = true;
            await logToChat('Róka', `🎯 ${validFixtures.length} db 13:00 utáni meccs elemezhető.`);
        } else {
            // HA NINCS MAI, NÉZZÜK A HOLNAPOT HOGY NE LEGYEN LIVERPOOL
            const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
            await logToChat('Róka', `🔎 Ma nincs alkalmas meccs, nézem a holnapi (${tomorrowStr}) listát...`);
            
            const nextDayRes = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${tomorrowStr}`, {
                headers: { 'x-apisports-key': process.env.SPORT_API_KEY, 'x-apisports-host': 'v3.football.api-sports.io' }
            });
            validFixtures = nextDayRes.data.response || [];
            if(validFixtures.length > 0) isRealData = true;
            else validFixtures = [{ fixture: { date: targetDate + "T21:00:00", id: 999 }, league: { name: "Bajnokok Ligája (SZIMULÁCIÓ)" }, teams: { home: { name: "Liverpool" }, away: { name: "Real Madrid" } } }];
        }

        const matchData = validFixtures.slice(0, 50).map(f => {
            const time = new Date(f.fixture.date).toLocaleTimeString('hu-HU', {timeZone:'Europe/Budapest', hour:'2-digit', minute:'2-digit'});
            return `[ID:${f.fixture.id}] ${time} - ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`;
        }).join("\n");

        const analysisPrompt = `SZEREP: Profi Matematikai Sportelemző. FELADAT: Válaszd ki az EGYETLEN LEGBIZTOSABB meccset. MÓD: ${strategyMode}. FORMAT (JSON): { "league": "...", "match": "...", "prediction": "...", "odds": "1.XX", "reasoning": "...", "profitPercent": 5, "matchTime": "ÓÓ:PP", "matchDate": "${targetDate}", "bookmaker": "Bet365", "stake": "${stakeAdvice}" }`;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "system", content: analysisPrompt }, { role: "user", content: `Kínálat:\n${matchData}` }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);

        const marketingRes = await openai.chat.completions.create({
             model: "gpt-4-turbo-preview",
             messages: [{ role: "system", content: "Profi Marketing Copywriter (Fox Persona)." }, { role: "user", content: `Írd át Zsivány Róka stílusban, kezdd így: 📅 MA ${result.matchTime} - ${result.match}: ${result.memberMessage || ''}` }] 
        });

        await Tip.findOneAndUpdate({ date: getDbDate() }, { 
            ...result, memberMessage: marketingRes.choices[0].message.content,
            recommendedStake: result.stake, date: getDbDate(), status: 'pending', isPublished: false, isReal: isRealData
        }, { upsert: true });

        await logToChat('Róka', `✅ **ELEMZÉS KÉSZ**: ${result.match} kiválasztva.`);
        return true;
    } catch (e) {
        await logToChat('System', `⚠️ Hiba: ${e.message}`);
        return false;
    }
}

// --- ÚTVONALAK (EREDETI GOMBOKKAL) ---
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
    if (!user.hasLicense) return res.redirect('/pricing');
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const streak = await calculateStreak();
    res.render('dashboard', { user, dailyTip, recommendedStake: Math.floor(user.startingCapital * 0.10), displayDate: new Date().toLocaleDateString('hu-HU'), foxQuotes, streak });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(50);
    res.render('admin', { users, currentTip, recentTips: [], stats: [], chatHistory, calculatorData: [], dbDate: getDbDate(), brandName: BRAND_NAME });
});

// GOMBOK (NE NYÚLJ HOZZÁ!)
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });
app.post('/admin/delete-today', checkAdmin, async (req, res) => { await Tip.findOneAndDelete({ date: getDbDate() }); res.redirect('/admin'); });
app.post('/admin/run-robot', checkAdmin, async (req, res) => { req.setTimeout(300000); await runAiRobot(); res.redirect('/admin'); });

// INTELLIGENS CHAT
app.post('/admin/chat', checkAdmin, async (req, res) => {
    const todayTip = await Tip.findOne({ date: getDbDate() });
    const systemPrompt = `Te vagy a Zsivány Róka AI. Mai tipp: ${todayTip ? todayTip.match : "Nincs még"}. Beszélj emberként a Főnökkel, a cél a havi profit!`;
    const aiRes = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: req.body.message }]
    });
    const reply = aiRes.choices[0].message.content;
    await logToChat('Róka', reply);
    res.json({ reply });
});

// AUTH ÉS EGYÉB
app.post('/auth/register', async (req, res) => { const h=await bcrypt.hash(req.body.password,10); try{const u=await new User({fullname:req.body.fullname,email:req.body.email.toLowerCase(),password:h}).save();req.session.userId=u._id;res.redirect('/pricing');}catch(e){res.send("Email foglalt");} });
app.post('/auth/login', async (req, res) => { const u=await User.findOne({email:req.body.email.toLowerCase()}); if(u&&await bcrypt.compare(req.body.password,u.password)){req.session.userId=u._id;res.redirect('/dashboard');}else res.send("Hiba"); });
app.post('/admin/activate-user', checkAdmin, async (req, res) => { const exp=new Date(); exp.setDate(exp.getDate()+30); await User.findByIdAndUpdate(req.body.userId, {hasLicense:true, licenseExpiresAt:exp}); res.redirect('/admin'); });
app.get('/stats', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const monthlyStats = await MonthlyStat.find({ isPublished: true }).sort({ month: -1 });
    const historyTips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(30);
    res.render('stats', { user, monthlyStats, historyTips, randomQuote: "Statisztika" });
});
app.get('/pricing', (req, res) => res.render('pricing')); app.get('/login', (req, res) => res.render('login')); app.get('/register', (req, res) => res.render('register')); app.get('/', (req, res) => res.render('index')); app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.listen(process.env.PORT || 8080);