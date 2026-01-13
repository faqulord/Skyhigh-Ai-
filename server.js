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

// Adatbázis csatlakozás
mongoose.connect(process.env.MONGO_URL || process.env.MONGO_URI)
    .then(() => console.log('✅ Skyhigh Core Online'))
    .catch(err => console.error('❌ DB Hiba:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: 'skyhigh_ultra_core_2024_secure',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL || process.env.MONGO_URI }),
    cookie: { maxAge: 86400000 }
}));

// Middlewares
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

// Autentikáció
app.post('/auth/register', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.password, 10);
        const newUser = new User({ 
            fullname: req.body.fullname, 
            email: req.body.email, 
            password: hashed 
        });
        await newUser.save();
        res.redirect('/login');
    } catch { res.send('Hiba a regisztráció során (az email már létezhet).'); }
});

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user && await bcrypt.compare(req.body.password, user.password)){
        req.session.userId = user._id;
        // Alapértelmezett admin te vagy, de az adatbázisból is olvassa
        req.session.isAdmin = user.isAdmin || (req.body.email === 'stylefaqu@gmail.com');
        res.redirect('/dashboard');
    } else { res.send('Hibás email vagy jelszó.'); }
});

// Admin: Új tulajdonos felhatalmazása
app.post('/admin/make-admin', requireAdmin, async (req, res) => {
    await User.findOneAndUpdate({ email: req.body.email }, { isAdmin: true });
    res.redirect('/admin');
});

// Felhasználói beállítások
app.post('/api/set-capital', requireLogin, async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital });
    res.json({ success: true });
});

// Dashboard lekérése
app.get('/dashboard', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const todayTip = await Tip.findOne().sort({ createdAt: -1 });
    const pastTips = await Tip.find().sort({ createdAt: -1 }).limit(10);
    res.render('dashboard', { user, isAdmin: req.session.isAdmin, dailyTip: todayTip, pastTips });
});

// Admin felület
app.get('/admin', requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 });
    res.render('admin', { users });
});

// Robot Chat Logika
app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const { message } = req.body;
        const user = await User.findById(req.session.userId);

        let systemPrompt = `
            Te a Skyhigh Core Kvantum-Asszisztens vagy. A cél a 6 hónapos profitciklus. 
            Amennyiben a felhasználónak nincs aktív licence, minden válaszod végén (vagy ha rákérdez) emlékeztesd: 
            "Figyelem: Az elemzések és a stratégiai együttműködés folytatásához elengedhetetlen a licencjog frissítése. Ne szakítsa meg a profit-folyamatot, aktiválja a hozzáférést a Dashboardon!"
            
            ADATOK: Tőke: ${user.startingCapital} Ft. 
            STÍLUS: Szigorú, profi, emberi, de tényalapú. A közös munka alapja a fegyelem. 
            Élőben elemzed a piacot, és a Master Tipp ennek a szűrt eredménye.
        `;

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }]
        });
        res.json({ reply: response.choices[0].message.content });
    } catch { res.status(500).json({ reply: "Szerver oldali hiba történt." }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Skyhigh Ultra fut a ${PORT} porton`));