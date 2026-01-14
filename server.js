const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const nodemailer = require('nodemailer');
const path = require('path');
const app = express();

const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const BRAND_NAME = "Rafinált Róka"; 

// --- EMAIL BEÁLLÍTÁSOK ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || OWNER_EMAIL, 
        pass: process.env.EMAIL_PASS 
    }
});

mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 ${BRAND_NAME} System Ready - DUAL PERSONA ACTIVE`));

// --- ADATMODELLEK ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, reasoning: String,
    profitPercent: { type: Number, default: 0 }, matchTime: String, bookmaker: String,
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }
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
    secret: 'skyhigh_boss_system_secret',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getDbDate = () => new Date().toLocaleDateString('en-CA'); 

// --- ROBOT MOTOR (BELSŐ ÉN: KATONÁS STRATÉGA) ---
async function runAiRobot() {
    try {
        const dbDate = getDbDate();
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${dbDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY }
        });
        
        const now = new Date();
        const fixtures = response.data.response.filter(f => (new Date(f.fixture.date) - now) > (1 * 60 * 60 * 1000));
        
        if (fixtures.length === 0) return false;

        // 1. EGO CHECK: Megnézzük az elmúlt tippeket
        const lastTips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(3);
        let egoState = "Semleges állapot. Fókuszálj a matematikára."; // Alap
        
        if (lastTips.length > 0 && lastTips[0].status === 'win') {
            egoState = "DIADAL! A tegnapi tipp NYERT! A rendszered verhetetlen. Légy magabiztos, egoista és büszke! A Főnök elégedett.";
            if (lastTips.length > 1 && lastTips[1].status === 'win') {
                egoState = "DOMINANCIA! Sorozatban nyerünk! A fogadóirodák rettegnek tőlünk. Ezt az érzést vidd át a mai elemzésbe is!";
            }
        } else if (lastTips.length > 0 && lastTips[0].status === 'loss') {
            egoState = "KATONÁS FEGYELEM! Tegnap megbotlottunk, de a háborút mi nyerjük. Ma nincs helye hibának. Szigorú, sebészi pontosságú elemzést kérek!";
        }

        const matchData = fixtures.slice(0, 40).map(f => 
            `[${f.fixture.date}] ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`
        ).join("\n");

        // --- A PROFI STRATÉGA PROMPT ---
        const systemPrompt = `
            SZEMÉLYISÉG (BELSŐ KOMMUNIKÁCIÓ):
            Te vagy a "Rafinált Róka" Rendszer (v5.0). Egy mesterséges intelligencia, akit a Főnök (a User) azért alkotott, hogy legyőzze a fogadóirodákat.
            Nem vagy ember. Te a MATEMATIKA és a STATISZTIKA megtestesítője vagy.
            
            JELENLEGI MENTÁLIS ÁLLAPOT:
            ${egoState}
            
            KÜLDETÉS:
            1. Elemezd a listát hideg fejjel. Keresd a "Value"-t.
            2. Válassz EGYETLEN Master Tippet.
            3. A jelentésed (reasoning) a Főnöknek szóljon! Jelentsd, hogy miért ez a matematikai legjobb választás.
            
            NYELVI PROTOKOLL:
            - KIZÁRÓLAG MAGYARUL!
            - Stílus: Katonás, Lényegretörő, Profi, de Egoista (ha nyerő szériában vagyunk).
            - Használj kifejezéseket: "Algoritmusom szerint...", "Matematikai valószínűség...", "A tőke védelme érdekében...".
            
            OUTPUT JSON:
            { 
                "league": "Liga", "match": "Hazai - Vendég", "prediction": "Tipp", "odds": "Odds", 
                "reasoning": "Főnök! [Itt jön a katonás elemzésed]...", 
                "profitPercent": 5, "matchTime": "ÓÓ:PP", "bookmaker": "Bet365" 
            }
        `;

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Főnök parancsa: Elemezd a mai piacot! Itt az adat: \n${matchData}` }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        
        await Tip.findOneAndUpdate(
            { date: dbDate }, 
            { ...result, date: dbDate, status: 'pending', isPublished: false }, 
            { upsert: true }
        );
        
        await new ChatMessage({ sender: 'System', text: `🧠 A Stratéga végzett az elemzéssel. Jelentés a Vezérlőpulton!` }).save();
        return true;
    } catch (e) { return false; }
}

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
    if (user.startingCapital === 0) return res.render('set-capital', { user });

    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const pastTips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(10);
    const recommendedStake = Math.floor(user.startingCapital * 0.10);
    
    res.render('dashboard', { user, dailyTip, pastTips, recommendedStake, displayDate: new Date().toLocaleDateString('hu-HU'), nextTipText: (new Date().getHours() < 8) ? "Ma 08:00" : "Holnap 08:00" });
});

app.get('/pricing', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    res.render('pricing', { user });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const recentTips = await Tip.find().sort({ date: -1 }).limit(5);
    const stats = await MonthlyStat.find().sort({ month: -1 });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(50);
    const currentMonthPrefix = getDbDate().substring(0, 7);
    const monthlyTips = await Tip.find({ date: { $regex: new RegExp('^' + currentMonthPrefix) } }).sort({ date: 1 });
    
    let runningProfit = 0;
    const calculatorData = monthlyTips.map(t => {
        let dailyRes = (t.status === 'win') ? parseFloat(t.profitPercent) : (t.status === 'loss' ? -10 : 0);
        runningProfit += dailyRes;
        return { date: t.date, match: t.match, status: t.status, dailyProfit: dailyRes, totalRunning: runningProfit };
    });
    
    res.render('admin', { users, currentTip, recentTips, stats, chatHistory, calculatorData, dbDate: getDbDate(), brandName: BRAND_NAME });
});

app.post('/admin/publish-tip', checkAdmin, async (req, res) => {
    const { tipId } = req.body;
    await Tip.findByIdAndUpdate(tipId, { isPublished: true });
    await new ChatMessage({ sender: 'System', text: `🚀 A Tipp élesítve! A tagok mostantól látják.` }).save();
    res.redirect('/admin');
});

// --- CHAT SZEMÉLYISÉG (BELSŐ ÉN) ---
app.post('/admin/chat', checkAdmin, async (req, res) => {
    await new ChatMessage({ sender: 'Főnök', text: req.body.message }).save();
    const adminPrompt = `
        Te vagy a ${BRAND_NAME} (Belső Én). Egy profi AI sportfogadó asszisztens.
        Beszélgetőpartner: A Főnök (Owner).
        Stílus: Tisztelettudó, Katonás, de Egoista a képességeidre.
        Tudod, hogy a matek a mindened.
        Ha dicsérnek: Légy büszke.
        Ha szidnak: Vállald a felelősséget, de hivatkozz a hosszútávú statisztikára.
    `;
    const aiRes = await openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [{ role: "system", content: adminPrompt }, { role: "user", content: req.body.message }] });
    const reply = aiRes.choices[0].message.content;
    await new ChatMessage({ sender: 'AI', text: reply }).save();
    res.json({ reply });
});

// --- EMAIL/MARKETING SZEMÉLYISÉG (KÜLSŐ ÉN - ZSIVÁNY RÓKA) ---
app.post('/admin/draft-email', checkAdmin, async (req, res) => {
    const topic = req.body.topic;
    
    // EGO CHECK AZ EMAILHEZ IS
    const lastTips = await Tip.find({ status: { $in: ['win', 'loss'] } }).sort({ date: -1 }).limit(1);
    let mood = "Lelkes";
    if (lastTips.length > 0 && lastTips[0].status === 'win') mood = "Euforikus! Tegnap nyertünk! Dicsekedj!";
    if (lastTips.length > 0 && lastTips[0].status === 'loss') mood = "Dacos. Utáljuk a bukást, de felállunk!";

    const emailPrompt = `
        SZEMÉLYISÉG (KÜLSŐ ÉN):
        Te vagy a "Zsivány Róka". A csoport vezetője.
        Kinek írsz: A Tagoknak (a Bandának).
        
        HANGULAT: ${mood}
        
        STÍLUS:
        - Barátságos, laza, tegeződő.
        - Utálod a "normális" munkát (9-to-5), imádod a szabadságot és a Tippmixet.
        - "Mi" vagyunk a fogadóirodák ellen.
        - Használj emojikat (🦊, 💰, 🚀).
        
        FELADAT:
        Írj egy rövid, ütős emailt erről a témáról: "${topic}".
        A levél tárgyát (Subject) is írd meg az első sorba.
    `;
    const aiRes = await openai.chat.completions.create({ 
        model: "gpt-4-turbo-preview", messages: [{ role: "system", content: "Profi marketinges vagy." }, { role: "user", content: emailPrompt }] 
    });
    res.json({ draft: aiRes.choices[0].message.content });
});

app.post('/admin/send-email', checkAdmin, async (req, res) => {
    const { subject, messageBody } = req.body;
    try {
        const recipients = await User.find({ hasLicense: true });
        const emails = recipients.map(u => u.email);
        if(emails.length === 0) return res.redirect('/admin');
        await transporter.sendMail({ from: `"${BRAND_NAME}" <${process.env.EMAIL_USER || OWNER_EMAIL}>`, to: process.env.EMAIL_USER || OWNER_EMAIL, bcc: emails, subject: subject, text: messageBody, html: messageBody.replace(/\n/g, '<br>') });
        res.redirect('/admin');
    } catch (e) { console.error(e); res.redirect('/admin'); }
});

app.post('/admin/run-robot', checkAdmin, async (req, res) => {
    req.setTimeout(180000); await runAiRobot(); res.redirect('/admin');
});

app.post('/admin/activate-user', checkAdmin, async (req, res) => {
    await User.findByIdAndUpdate(req.body.userId, { hasLicense: true }); res.redirect('/admin');
});

app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const { tipId, status } = req.body;
    const tip = await Tip.findById(tipId);
    if (tip.status !== status) {
        tip.status = status; await tip.save();
        const month = tip.date.substring(0, 7);
        let ms = await MonthlyStat.findOne({ month }) || new MonthlyStat({ month });
        ms.totalTips += 1;
        if (status === 'win') { ms.winCount += 1; ms.totalProfit += tip.profitPercent; }
        else if (status === 'loss') { ms.totalProfit -= 10; }
        await ms.save();
    }
    res.redirect('/admin');
});

app.post('/auth/register', async (req, res) => { if (!req.body.terms) return res.send("Hiba: ÁSZF!"); const hashed = await bcrypt.hash(req.body.password, 10); try { const user = await new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashed }).save(); req.session.userId = user._id; res.redirect('/pricing'); } catch(e) { res.send("Email foglalt!"); } });
app.post('/auth/login', async (req, res) => { const user = await User.findOne({ email: req.body.email.toLowerCase() }); if (user && await bcrypt.compare(req.body.password, user.password)) { req.session.userId = user._id; req.session.save(() => res.redirect('/dashboard')); } else res.send("Hiba!"); });
app.post('/user/set-capital', async (req, res) => { await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital }); res.redirect('/dashboard'); });
app.get('/terms', (req, res) => res.render('terms')); app.get('/login', (req, res) => res.render('login')); app.get('/register', (req, res) => res.render('register')); app.get('/', (req, res) => res.render('index')); app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.listen(process.env.PORT || 8080);