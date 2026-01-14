const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const nodemailer = require('nodemailer');
const path = require('path');
const cron = require('node-cron');
const app = express();

const OWNER_EMAIL = "stylefaqu@gmail.com"; 
const BRAND_NAME = "Rafinált Róka"; 

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER || OWNER_EMAIL, pass: process.env.EMAIL_PASS }
});

mongoose.connect(process.env.MONGO_URL).then(() => console.log(`🚀 ${BRAND_NAME} System Online`));

// MODELLEK
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true, lowercase: true },
    password: String, hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false }, startingCapital: { type: Number, default: 0 }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    league: String, match: String, prediction: String, odds: String, 
    reasoning: String, memberMessage: String,
    profitPercent: { type: Number, default: 5 }, 
    status: { type: String, default: 'pending' }, 
    isPublished: { type: Boolean, default: false },
    date: { type: String, index: true }
}));

const MonthlyStat = mongoose.model('MonthlyStat', new mongoose.Schema({
    month: String, totalProfit: { type: Number, default: 0 }, winCount: { type: Number, default: 0 }, totalTips: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: false }
}));

const ChatMessage = mongoose.model('ChatMessage', new mongoose.Schema({
    sender: String, text: String, timestamp: { type: Date, default: Date.now }
}));

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'skyhigh_fox_secret_key',
    resave: true, saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getDbDate = () => new Date().toLocaleDateString('en-CA');

// 🦊 ROBOT: AZ ÖREG RÓKA JELENTÉSE (ADMINNAK)
async function runAiRobot() {
    try {
        const dbDate = getDbDate();
        const response = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${dbDate}`, {
            headers: { 'x-apisports-key': process.env.SPORT_API_KEY }
        });
        const fixtures = response.data.response.slice(0, 40).map(f => `[${f.fixture.date}] ${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`).join("\n");

        const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: "Te vagy a 'Rafinált Róka' szakmai énje. Adatközpontú, profi aszisztens. Csak JSON-t válaszolj." },
                { role: "user", content: `Elemezd a mai kínálatot és válassz egy Master Tippet: \n${fixtures}` }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(aiRes.choices[0].message.content);
        await Tip.findOneAndUpdate({ date: dbDate }, { ...result, date: dbDate, isPublished: false }, { upsert: true });
        return true;
    } catch (e) { return false; }
}

// AUTOMATIZÁLT INDÍTÁS REGGEL 8-KOR
cron.schedule('0 8 * * *', () => { runAiRobot(); }, { timezone: "Europe/Budapest" });

const checkAdmin = async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.email === OWNER_EMAIL)) return next();
    res.redirect('/dashboard');
};

// ÚTVONALAK
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user.hasLicense) return res.redirect('/pricing');
    if (user.startingCapital === 0) return res.render('set-capital', { user });

    const dailyTip = await Tip.findOne({ date: getDbDate(), isPublished: true });
    const recommendedStake = Math.floor(user.startingCapital * 0.10);
    res.render('dashboard', { user, dailyTip, recommendedStake, displayDate: new Date().toLocaleDateString('hu-HU'), randomQuote: "A matek nem hazudik, tesó." });
});

app.get('/admin', checkAdmin, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    const currentTip = await Tip.findOne({ date: getDbDate() });
    const recentTips = await Tip.find().sort({ date: -1 }).limit(5);
    const stats = await MonthlyStat.find().sort({ month: -1 });
    const chatHistory = await ChatMessage.find().sort({ timestamp: 1 }).limit(30);
    res.render('admin', { users, currentTip, recentTips, stats, chatHistory, dbDate: getDbDate(), brandName: BRAND_NAME });
});

// 📢 PUBLIKÁLÁS: ITT VÁLT ÁT ZSIVÁNYBA A RÓKA
app.post('/admin/publish-tip', checkAdmin, async (req, res) => {
    const { tipId } = req.body;
    const tip = await Tip.findById(tipId);
    
    const aiRes = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
            { role: "system", content: "Te vagy a Zsivány Róka. Dörzsölt, szlenges, magabiztos tinédzser stílusban beszélj a tagokhoz. Használj olyanokat: 'vágod tesó', 'dől a lé', 'matek'. Rövid légy!" },
            { role: "user", content: `Írd át ezt a tippet a tagoknak: ${tip.reasoning}` }
        ]
    });

    await Tip.findByIdAndUpdate(tipId, { 
        isPublished: true, 
        memberMessage: aiRes.choices[0].message.content 
    });
    res.redirect('/admin');
});

app.post('/admin/settle-tip', checkAdmin, async (req, res) => {
    const { tipId, status } = req.body;
    const tip = await Tip.findById(tipId);
    tip.status = status; await tip.save();
    
    const month = tip.date.substring(0, 7);
    let ms = await MonthlyStat.findOne({ month }) || new MonthlyStat({ month });
    ms.totalTips += 1;
    if (status === 'win') { ms.winCount += 1; ms.totalProfit += tip.profitPercent; }
    else if (status === 'loss') { ms.totalProfit -= 10; }
    await ms.save();
    res.redirect('/admin');
});

// AUTH ÉS EGYEBEK (Marad az eredeti logikád szerint)
app.post('/auth/register', async (req, res) => {
    const hashed = await bcrypt.hash(req.body.password, 10);
    try {
        const user = await new User({ fullname: req.body.fullname, email: req.body.email.toLowerCase(), password: hashed }).save();
        req.session.userId = user._id; res.redirect('/pricing');
    } catch(e) { res.send("Email foglalt!"); }
});
app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id; res.redirect('/dashboard');
    } else res.send("Hiba!");
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.listen(process.env.PORT || 8080);