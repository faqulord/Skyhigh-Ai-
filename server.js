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
    secret: 'skyhigh_quantum_ultra_2026',
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
    } catch { res.send('Hiba.'); }
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
    res.render('dashboard', { user, isAdmin: req.session.isAdmin, dailyTip: todayTip });
});

// Licenc aktiválás motiváló válaszhoz
app.post('/api/activate-license', requireLogin, async (req, res) => {
    const { plan } = req.body;
    let days = plan === 'yearly' ? 365 : 30;
    await User.findByIdAndUpdate(req.session.userId, {
        hasLicense: true,
        licenseExpires: new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    });
    res.json({ success: true, message: "Gratulálok! A licenc aktiválva. A rendszer készen áll a profit termelésre! 🚀" });
});

app.post('/api/set-capital', requireLogin, async (req, res) => {
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: req.body.capital });
    res.json({ success: true });
});

// INTELLIGENS CHAT LOGIKA EMOJIKKAL
app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const systemPrompt = `
            Te vagy a Skyhigh Core, egy prémium sportfogadási AI asszisztens. 🧠💰
            A célod: A felhasználó bankrolljának (${user.startingCapital} Ft) megvédése és növelése a 6 hónapos ciklus alatt.
            STÍLUS: Legyél profi, magabiztos, használj releváns emojikat (🚀, 📈, ✅, 🏦, ⚽).
            HA NINCS LICENCE: Minden válaszod végén emlékeztesd, hogy a Master Tippek eléréséhez licenc szükséges.
            HA VAN LICENCE: Gratulálj a döntéséhez, és hangsúlyozd a fegyelmet!
            FONTOS: Mindig reggel 8-kor elemezzük a legfrissebb adatokat.
        `;

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: req.body.message }]
        });
        res.json({ reply: response.choices[0].message.content });
    } catch { res.json({ reply: "Sajnálom, technikai hiba az adatkapcsolatban. ⚠️" }); }
});

app.listen(process.env.PORT || 3000);