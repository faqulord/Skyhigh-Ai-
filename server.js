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

// --- RÓKA DUMÁK (MARADT AZ EREDETI) ---
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
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    licenseExpiresAt: { type: Date }, isAdmin: { type: Boolean, default: false }, 
    startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.models.Tip || mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String, profitPercent: { type: Number, default: 0 }, 
    matchTime: String, matchDate: String, bookmaker: String, recommendedStake: { type: String, default: "3%" },
    status: { type: String, default: 'pending' }, isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }, isReal: { type: Boolean, default: false }
}));

const MonthlyStat = mongoose.models.MonthlyStat || mongoose.model('MonthlyStat', new mongoose.Schema({
    month: String, totalProfit: { type: Number, default: 0 }, winCount: { type: Number, default: 0 }, 
    lossCount: { type: Number, default: 0 }, totalTips: { type: Number, default: 0 }, isPublished: { type: Boolean, default: false }
}));

const ChatMessage = mongoose.models.ChatMessage || mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

// --- SEGÉDFÜGGVÉNYEK ---
const getDbDate = () => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Budapest' });
};

async function logToChat(sender, message) {
    const timeStr = new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });
    await new ChatMessage({ sender, text: `[${timeStr}] ${message}` }).save();
}

mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 System Ready - Direct API Fix`));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- RÓKA ELEMZÉS (JAVÍTOTT DIRECT API KAPCSOLAT ÉS 13-24 SZŰRÉS) ---
async function runAiRobot() {
    await ChatMessage.deleteMany({});
    const targetDate = getDbDate();
    
    // Stratégia lekérése
    const m = targetDate.substring(0, 7);
    const stat = await MonthlyStat.findOne({ month: m }) || { totalProfit: 0 };
    let strategyMode = stat.totalProfit >= 30 ? "DEFENSIVE" : (stat.totalProfit < -10 ? "RECOVERY" : "NORMAL");
    let stakeAdvice = strategyMode === "DEFENSIVE" ? "1-2%" : "3%";

    await logToChat('Róka', `📊 Mód: ${strategyMode} | Cél: Havi Profit Maximalizálása`);

    try {
        // DIRECT API HÍVÁS (api-football.com kulcshoz)
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${targetDate}`, {
            headers: { 
                'x-apisports-key': process.env.SPORT_API_KEY, 
                'x-apisports-host': 'v3.football.api-sports.io' 
            }
        });

        let fixtures = response.data.response || [];
        await logToChat('System', `📡 API válasz: ${fixtures.length} meccs érkezett.`);

        // 13:00 - 23:59 SZŰRÉS
        let validFixtures = fixtures.filter(f => {
            const matchDate = new Date(f.fixture.date);
            const hunHour = parseInt(matchDate.toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', hour12: false }));
            return hunHour >= 13 && hunHour <= 23;
        });

        let isRealData = validFixtures.length > 0;

        if (!isRealData) {
            await logToChat('Róka', `🔎 Ma nincs több alkalmas meccs, a biztonsági tartalékot aktiválom...`);
            validFixtures = [{ fixture: { date: targetDate + "T21:00:00", id: 999 }, league: { name: "Bajnokok Ligája (SZIMULÁCIÓ)" }, teams: { home: { name: "Liverpool" }, away: { name: "Real Madrid" } } }];
        }

        const matchData = validFixtures.slice(0, 40).map(f => {
            const time = new Date(f.fixture.date).toLocaleTimeString('hu-HU', {timeZone:'Europe/Budapest', hour:'2-digit', minute:'2-digit'});
            return `[${time}] ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`;
        }).join("\n");

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: `Te vagy a Zsivány Róka. Válaszd ki az EGYETLEN LEGBIZTOSABB meccset a listából a havi profit érdekében.` },
                { role: "user", content: `Kínálat:\n${matchData}` }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);

        // Marketing szöveg generálása a Róka stílusában
        const marketingRes = await openai.chat.completions.create({
             model: "gpt-4-turbo-preview",
             messages: [{ role: "system", content: "Profi Marketing Copywriter (Fox Persona)." }, { role: "user", content: `Írd át Zsivány Róka stílusban, kezdd így: 📅 MA ${result.matchTime || '21:00'} - ${result.match}: ...` }] 
        });

        await Tip.findOneAndUpdate({ date: targetDate }, { 
            ...result, 
            memberMessage: marketingRes.choices[0].message.content,
            recommendedStake: stakeAdvice, 
            date: targetDate, 
            isPublished: false, 
            isReal: isRealData 
        }, { upsert: true });

        await logToChat('Róka', `✅ ELEMZÉS KÉSZ: ${result.match} kiválasztva.`);
        return true;

    } catch (e) {
        await logToChat('System', `⚠️ HIBA: Az API nem válaszol. Ellenőrizd az új kulcsot!`);
        return false;
    }
}

// --- ADMIN ÚTVONALAK (EREDETI GOMBOKKAL) ---
const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'skyhigh_v29_secret', resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(50);
    res.render('admin', { users, currentTip, chatHistory, dbDate: getDbDate(), brandName: BRAND_NAME, recentTips: [], stats: [], calculatorData: [] });
});

// GOMBOK (EREDETI ÚTVONALAK)
app.post('/admin/run-robot', checkAdmin, async (req, res) => { req.setTimeout(300000); await runAiRobot(); res.redirect('/admin'); });
app.post('/admin/delete-today', checkAdmin, async (req, res) => { await Tip.findOneAndDelete({ date: getDbDate() }); res.redirect('/admin'); });
app.post('/admin/publish-tip', checkAdmin, async (req, res) => { await Tip.findByIdAndUpdate(req.body.tipId, { isPublished: true }); res.redirect('/admin'); });

// INTELLIGENS ADMIN CHAT
app.post('/admin/chat', checkAdmin, async (req, res) => {
    const todayTip = await Tip.findOne({ date: getDbDate() });
    const m = getDbDate().substring(0, 7);
    const stat = await MonthlyStat.findOne({ month: m });
    const systemPrompt = `Te vagy a Zsivány Róka AI. Mai tipp: ${todayTip ? todayTip.match : "Nincs még"}. Havi profit: ${stat ? stat.totalProfit : 0}%. Beszélj emberként a Főnökkel a cél a havi profit!`;
    const aiRes = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: req.body.message }]
    });
    const reply = aiRes.choices[0].message.content;
    await logToChat('Róka', reply);
    res.json({ reply });
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    res.render('dashboard', { user, dailyTip, recommendedStake: 1000, displayDate: new Date().toLocaleDateString('hu-HU'), foxQuotes, streak: 0 });
});

app.post('/auth/login', async (req, res) => {
    const u = await User.findOne({ email: req.body.email.toLowerCase() });
    if (u && await bcrypt.compare(req.body.password, u.password)) { req.session.userId = u._id; res.redirect('/dashboard'); }
    else res.send("Hiba");
});

app.get('/login', (req, res) => res.render('login'));
app.get('/', (req, res) => res.render('index'));

app.listen(process.env.PORT || 8080);