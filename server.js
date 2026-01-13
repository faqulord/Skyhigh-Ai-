const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');
const OpenAI = require('openai');

const User = require('./models/User');
const Tip = require('./models/Tip');

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

mongoose.connect(process.env.MONGO_URL || process.env.MONGO_URI);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: 'skyhigh_ultra_core_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL || process.env.MONGO_URI }),
    cookie: { maxAge: 86400000 }
}));

const requireLogin = (req, res, next) => req.session.userId ? next() : res.redirect('/login');
const requireAdmin = (req, res, next) => {
    if (req.session.userId && req.session.isAdmin) return next();
    res.redirect('/dashboard');
};

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
    } catch { res.send('Hiba történt.'); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user && await bcrypt.compare(req.body.password, user.password)){
        req.session.userId = user._id;
        req.session.isAdmin = user.isAdmin || (req.body.email === 'stylefaqu@gmail.com');
        res.redirect('/dashboard');
    } else { res.send('Hiba.'); }
});

app.get('/dashboard', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const todayTip = await Tip.findOne().sort({ createdAt: -1 });
    const pastTips = await Tip.find().sort({ createdAt: -1 }).limit(10);
    res.render('dashboard', { user, isAdmin: req.session.isAdmin, dailyTip: todayTip, pastTips });
});

// --- ADMIN PANEL STATISZTIKÁVAL ---
app.get('/admin', requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 });
    
    // Számítások
    const totalUsers = users.length;
    const activeSubscribers = users.filter(u => u.hasLicense).length;
    const monthlyRevenue = activeSubscribers * 20000; // 20.000 Ft per aktív tag

    res.render('admin', { 
        users, 
        stats: {
            totalUsers,
            activeSubscribers,
            monthlyRevenue
        }
    });
});

app.post('/admin/make-admin', requireAdmin, async (req, res) => {
    await User.findOneAndUpdate({ email: req.body.email }, { isAdmin: true });
    res.redirect('/admin');
});

app.post('/api/set-capital', requireLogin, async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital });
    res.json({ success: true });
});

app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const systemPrompt = `Te a Skyhigh Core vagy. A cél a 6 hónapos profit. Tőke: ${user.startingCapital} Ft.`;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: req.body.message }]
        });
        res.json({ reply: response.choices[0].message.content });
    } catch { res.json({ reply: "Hiba." }); }
});

app.listen(process.env.PORT || 3000);