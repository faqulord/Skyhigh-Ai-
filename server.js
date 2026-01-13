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

// Adatbázis Kapcsolat
mongoose.connect(process.env.MONGO_URL || process.env.MONGO_URI)
    .then(() => console.log('✅ DB KAPCSOLAT OK'))
    .catch(err => console.log('❌ DB HIBA:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: 'skyhigh_quantum_core_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL || process.env.MONGO_URI }),
    cookie: { maxAge: 86400000 }
}));

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
    } catch { res.send('Hiba a regisztrációnál.'); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user && await bcrypt.compare(req.body.password, user.password)){
        req.session.userId = user._id;
        req.session.isAdmin = user.isAdmin || (req.body.email === 'stylefaqu@gmail.com');
        res.redirect('/dashboard');
    } else { res.send('Hibás adatok.'); }
});

app.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const todayTip = await Tip.findOne().sort({ createdAt: -1 });
        res.render('dashboard', { user, isAdmin: req.session.isAdmin, dailyTip: todayTip });
    } catch { res.redirect('/login'); }
});

app.get('/admin', requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 });
    const stats = {
        totalUsers: users.length,
        activeSubs: users.filter(u => u.hasLicense).length,
        revenue: users.filter(u => u.hasLicense).length * 20000
    };
    res.render('admin', { users, stats });
});

app.post('/admin/make-admin', requireAdmin, async (req, res) => {
    await User.findOneAndUpdate({ email: req.body.email }, { isAdmin: true });
    res.redirect('/admin');
});

app.post('/api/activate-license', requireLogin, async (req, res) => {
    const { plan } = req.body;
    let days = plan === 'yearly' ? 365 : 30;
    await User.findByIdAndUpdate(req.session.userId, {
        hasLicense: true,
        licenseExpires: new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    });
    res.json({ success: true, message: "Licenc sikeresen aktiválva! 🚀" });
});

app.post('/api/set-capital', requireLogin, async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital });
    res.json({ success: true });
});

app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const systemPrompt = `Te vagy Skyhigh Core AI. Tőke: ${user.startingCapital} Ft. Legyél profi, használj emojikat 🚀📊.`;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: req.body.message }]
        });
        res.json({ reply: response.choices[0].message.content });
    } catch { res.json({ reply: "Hiba az AI kapcsolatban." }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Skyhigh Live: ${PORT}`));