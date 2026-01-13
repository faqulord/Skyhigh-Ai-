const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');
const axios = require('axios');
const OpenAI = require('openai');

const User = require('./models/User');
const Tip = require('./models/Tip');

const app = express();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
const SPORT_API_KEY = process.env.SPORT_API_KEY; 
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const dbURI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/skyhigh';
mongoose.connect(dbURI).then(() => console.log('✅ Skyhigh System Online')).catch(err => console.log('❌ DB Hiba:', err));

app.use(express.json()); 
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET || 'skyhigh_quantum_2024',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURI }),
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
    } catch { res.send('Email foglalt.'); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user && await bcrypt.compare(req.body.password, user.password)){
        req.session.userId = user._id;
        req.session.isAdmin = (req.body.email === 'stylefaqu@gmail.com');
        res.redirect('/dashboard');
    } else { res.send('Hiba.'); }
});

// DASHBOARD - MÚLTBELI TIPPEKKEL
app.get('/dashboard', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const todayTip = await Tip.findOne().sort({ createdAt: -1 });
    const pastTips = await Tip.find().sort({ createdAt: -1 }).limit(5); // Utolsó 5 tipp
    res.render('dashboard', { user, dailyTip: todayTip, pastTips });
});

// ADMIN PANEL
app.get('/admin', requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 });
    const tips = await Tip.find().sort({ createdAt: -1 });
    res.render('admin', { users, tips });
});

// AI CHAT - A TÖKÉLETES PROMPT
app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const { message } = req.body;
        const user = await User.findById(req.session.userId);

        if (!user.hasLicense) {
            if (user.freeMessagesCount >= 2) return res.json({ reply: "⛔ <b>LICENC SZÜKSÉGES:</b> A Skyhigh Core elemzései és a garantált profit-stratégia eléréséhez aktiváld a licencet (20.000 Ft)." });
            user.freeMessagesCount++; await user.save();
        }

        const systemPrompt = `
        Te vagy a Skyhigh Core, egy zseniális Digitális Elme. 
        KÉPESSÉG: Élőben elemzed a világ összes mérkőzését. Nem tippelsz, hanem matematikai stratégiát futtatsz.
        GARANCIA: Magyarázd el: a rendszer matekra épül, a 30 napos ciklusban a profit GARANTÁLT, ha az Operátor fegyelmezett.
        LICENC: A licenc (20.000 Ft) hozzáférést ad a napi Master Tipphez és az élő portfólió-kezeléshez.
        TŐKE: A felhasználó tőkéje: ${user.startingCapital} Ft. Ez alapján számolj egyéni téteket (max 5%).
        Üzenet: Ha új ember, mutatkozz be profin, barátságosan, de szigorúan.
        `;

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }]
        });
        res.json({ reply: response.choices[0].message.content });
    } catch { res.json({ reply: "Rendszerhiba." }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Skyhigh Live: ${PORT}`));