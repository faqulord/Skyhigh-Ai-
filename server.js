const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');
const User = require('./models/User');

const app = express();

// --- ADATBÁZIS ---
const dbURI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/skyhigh';
mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.log('❌ DB Error:', err));

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// --- SESSION ---
app.use(session({
    secret: 'director_secret_key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 nap
}));

// --- JOGOSULTSÁG ELLENŐRZŐK ---
const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.isAdmin) return res.redirect('/dashboard');
    next();
};

// --- PUBLIKUS OLDALAK ---
app.get('/', (req, res) => res.render('index'));
app.get('/technologia', (req, res) => res.render('tech'));
app.get('/strategia', (req, res) => res.render('profit'));
app.get('/mlm', (req, res) => res.render('mlm'));
app.get('/regisztracio', (req, res) => res.render('register'));
app.get('/login', (req, res) => res.render('login'));

// --- LOGOUT ---
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- PRIVÁT OLDALAK ---

// 1. DASHBOARD (Mindenki ide kerül)
app.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        // Átadjuk a user adatait ÉS azt, hogy Admin-e
        res.render('dashboard', { 
            user: user, 
            isAdmin: req.session.isAdmin 
        });
    } catch (err) {
        res.redirect('/login');
    }
});

// 2. ADMIN PANEL (Csak Te éred el a gombbal)
app.get('/admin', requireLogin, requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 }); // Legfrissebb elől
    res.render('admin', { users: users });
});

// --- AUTH LOGIKA ---
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.send('Nincs ilyen felhasználó!');

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.send('Hibás jelszó!');

        req.session.userId = user._id;
        
        // ITT DŐL EL, HOGY KI AZ ADMIN
        if (email === 'stylefaqu@gmail.com') {
            req.session.isAdmin = true;
        } else {
            req.session.isAdmin = false;
        }

        // Mindenki a Dashboardra megy, de a Session tudja, ki vagy
        res.redirect('/dashboard');

    } catch (err) {
        res.send('Hiba');
    }
});

app.post('/auth/register', async (req, res) => {
    const { fullname, email, password } = req.body;
    try {
        const existing = await User.findOne({ email });
        if (existing) return res.send('Ez az email már foglalt.');
        
        const salt = await bcrypt.genSalt(10);
        const hashed = await bcrypt.hash(password, salt);
        const code = 'SKY-' + Math.floor(1000 + Math.random() * 9000);
        
        await new User({ fullname, email, password: hashed, myReferralCode: code }).save();
        res.redirect('/login');
    } catch (err) {
        res.send('Hiba');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Run on ${PORT}`));