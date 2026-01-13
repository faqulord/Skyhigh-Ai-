const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const path = require('path');
const app = express();

// --- ADATBÁZIS ---
const MONGO_CONNECTION = process.env.MONGO_URL;

mongoose.connect(MONGO_CONNECTION)
.then(() => console.log("✅ DB OK"))
.catch(err => console.error("❌ DB Hiba:", err));

// --- MODELLEK ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String, email: { type: String, unique: true }, password: String,
    startingCapital: { type: Number, default: 0 }, hasLicense: { type: Boolean, default: true }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, prediction: String, odds: String, reasoning: String,
    date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}));

// --- MEGJELENÍTÉS KÉNYSZERÍTÉSE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'skyhigh_force_render_2026',
    resave: true,
    saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: MONGO_CONNECTION }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- MINDEN VÁLASZ ELŐTT KÉNYSZERÍTJÜK A HTML TÍPUST ---
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    next();
});

// --- ÚTVONALAK ---
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId);
        const today = new Date().toISOString().split('T')[0];
        let dailyTip = await Tip.findOne({ date: today });

        if (!dailyTip) {
            dailyTip = { 
                match: "Newcastle vs. Man. City", 
                prediction: "Man. City", 
                odds: "1.65", 
                reasoning: "A Skyhigh Core AI elemzése alapján a City dominanciája várható." 
            };
        }
        // Itt a render kényszerítése
        return res.render('dashboard', { user, dailyTip });
    } catch (err) {
        res.redirect('/login');
    }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user._id;
        req.session.save(() => res.redirect('/dashboard'));
    } else {
        res.send("<h2>Hibás adatok! <a href='/login'>Vissza</a></h2>");
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Master Engine Online`));