const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');
const OpenAI = require('openai');
const axios = require('axios');

const User = require('./models/User');
const Tip = require('./models/Tip');

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Adatbázis csatlakozás
mongoose.connect(process.env.MONGO_URL || process.env.MONGO_URI)
    .then(() => console.log('🚀 Skyhigh Core Online'))
    .catch(err => console.error('❌ DB Hiba:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: 'skyhigh_quantum_secure_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL || process.env.MONGO_URI }),
    cookie: { maxAge: 86400000 }
}));

// Middlewares
const requireLogin = (req, res, next) => req.session.userId ? next() : res.redirect('/login');
const requireAdmin = (req, res, next) => (req.session.userId && req.session.isAdmin) ? next() : res.redirect('/dashboard');

// --- ÚTVONALAK ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/regisztracio', (req, res) => res.render('register'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.post('/auth/register', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.password, 10);
        await new User({ fullname: req.body.fullname, email: req.body.email, password: hashed }).save();
        res.redirect('/login');
    } catch { res.send('Hiba: Az email már foglalt.'); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user && await bcrypt.compare(req.body.password, user.password)){
        req.session.userId = user._id;
        req.session.isAdmin = user.isAdmin || (req.body.email === 'stylefaqu@gmail.com');
        res.redirect('/dashboard');
    } else { res.send('Hibás adatok.'); }
});

// Admin funkciók
app.post('/admin/make-admin', requireAdmin, async (req, res) => {
    await User.findOneAndUpdate({ email: req.body.email }, { isAdmin: true });
    res.redirect('/admin');
});

app.get('/admin', requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 });
    const totalUsers = users.length;
    const activeSubs = users.filter(u => u.hasLicense).length;
    const revenue = activeSubs * 20000;
    res.render('admin', { users, stats: { totalUsers, activeSubs, revenue } });
});

// Dashboard
app.get('/dashboard', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const todayTip = await Tip.findOne().sort({ createdAt: -1 });
    const pastTips = await Tip.find().sort({ createdAt: -1 }).limit(5);
    res.render('dashboard', { user, isAdmin: req.session.isAdmin, dailyTip: todayTip, pastTips });
});

app.post('/api/set-capital', requireLogin, async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital });
    res.json({ success: true });
});

// AI Robot - Skyhigh Core
app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const systemPrompt = `Te vagy a Skyhigh Core, egy zseniális Digitális Elme. Élőben elemzed a piacokat. 
        A cél a 6 hónapos profit-ciklus. Tőke: ${user.startingCapital} Ft. Tét: tőke 5%-a. 
        Ha nincs licenc, emlékeztesd 5 üzenetenként a licenc-jog frissítésére. 
        Stílusod: Profi, szigorú, de barátságos. Magyarázd el a 30 napos matekot és a Master Tipp jelentőségét.`;

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: req.body.message }]
        });
        res.json({ reply: response.choices[0].message.content });
    } catch { res.json({ reply: "Rendszerhiba." }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Skyhigh System Online: ${PORT}`));