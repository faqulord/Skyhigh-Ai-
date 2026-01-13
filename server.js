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
mongoose.connect(dbURI).then(() => console.log('✅ DB OK')).catch(err => console.log('❌ DB Hiba:', err));

app.use(express.json()); 
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET || 'titkos',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURI }),
    cookie: { maxAge: 86400000 }
}));

const requireLogin = (req, res, next) => req.session.userId ? next() : res.redirect('/login');

// FŐOLDAL ÉS AUTH
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/regisztracio', (req, res) => res.render('register'));

app.post('/auth/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if(user && await bcrypt.compare(req.body.password, user.password)){
        req.session.userId = user._id;
        req.session.isAdmin = (req.body.email === 'stylefaqu@gmail.com');
        res.redirect('/dashboard');
    } else { res.send('Hibás adatok'); }
});

// DASHBOARD
app.get('/dashboard', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const todayTip = await Tip.findOne().sort({ createdAt: -1 });
    res.render('dashboard', { user, dailyTip: todayTip });
});

// --- AI ASSZISZTENS PROGRAMOZÁSA ---
app.post('/api/chat', requireLogin, async (req, res) => {
    try {
        const { message } = req.body;
        const user = await User.findById(req.session.userId);

        const prompt = `Te vagy a Skyhigh Core, egy barátságos, de szigorú Kvantum-Asszisztens. 
        STÍLUS: Profi, tényalapú, fegyelmezett. 
        SZABÁLYOK:
        1. Ha ez az első üzenet, mutatkozz be: "Üdvözlöm, Operátor. Én a Skyhigh AI Kvantum-Asszisztense vagyok..."
        2. A Master Tipp minden nap fixen 08:00-kor frissül a felületen. Soha ne adj ki pontos tippet chatben!
        3. A holnapi meccsekről beszélhetsz szakmai szinten (esélyek, adatok), de tilos konkrét kimenetelt vagy odds-ot jósolni a holnapi napra.
        4. Tőke: ${user.startingCapital} Ft. Mindig hangsúlyozd az 5%-os bankroll szabályt és a 30 napos ciklust.
        5. Ha a felhasználó kapzsi, legyél szigorú: "A fegyelem a profit alapja, Operátor."`;

        const gpt = await openai.chat.completions.create({
            messages: [{ role: "system", content: prompt }, { role: "user", content: message }],
            model: "gpt-3.5-turbo"
        });
        res.json({ reply: gpt.choices[0].message.content });
    } catch { res.status(500).json({ reply: "Rendszerhiba az elemzés során." }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Skyhigh System Online: ${PORT}`));