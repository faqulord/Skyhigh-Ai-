const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');
const User = require('./models/User');

const app = express();

// --- 1. ADATBÁZIS KAPCSOLAT (Részletes hibaüzenettel) ---
const dbURI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/skyhigh';
mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB SIKERESEN CSATLAKOZTATVA'))
    .catch(err => console.log('❌ FATÁLIS DB HIBA:', err));

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// --- 2. SESSION BEÁLLÍTÁS ---
app.use(session({
    secret: 'director_secret_key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- 3. JOGOSULTSÁG ELLENŐRZŐK ---
const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
        return res.send('<h1 style="color:red">HIBA: Nem vagy bejelentkezve! <a href="/login">Kattints ide a belépéshez</a></h1>');
    }
    next();
};

// --- 4. ÚTVONALAK ---

// Főoldalak
app.get('/', (req, res) => res.render('index'));
app.get('/technologia', (req, res) => res.render('tech'));
app.get('/strategia', (req, res) => res.render('profit'));
app.get('/mlm', (req, res) => res.render('mlm'));
app.get('/regisztracio', (req, res) => res.render('register'));
app.get('/login', (req, res) => res.render('login'));

// !!! TITKOS DIAGNOSZTIKA !!! (Ezt hívd meg, ha nem tudsz belépni)
app.get('/debug', async (req, res) => {
    try {
        const users = await User.find();
        res.send(`
            <h1>ADATBÁZIS DIAGNOSZTIKA</h1>
            <p>Regisztrált felhasználók száma: ${users.length}</p>
            <ul>
                ${users.map(u => `<li>${u.email} (Jelszó hash: ${u.password.substring(0,10)}...)</li>`).join('')}
            </ul>
            <a href="/login">Vissza a belépéshez</a>
        `);
    } catch (err) {
        res.send('ADATBÁZIS HIBA: ' + err.message);
    }
});

// --- 5. BEJELENTKEZÉS LOGIKA (Beszédes hibaüzenetekkel) ---
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        console.log('Belépési kísérlet:', email);
        
        // 1. Megkeressük a felhasználót
        const user = await User.findOne({ email });
        if (!user) {
            return res.send(`
                <h1 style="color:red">HIBA: Nincs ilyen felhasználó!</h1>
                <p>A(z) <b>${email}</b> cím nincs az adatbázisban.</p>
                <a href="/regisztracio">Regisztrálj itt</a> vagy <a href="/login">Próbáld újra</a>
            `);
        }

        // 2. Jelszó ellenőrzés
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.send(`
                <h1 style="color:red">HIBA: Hibás jelszó!</h1>
                <a href="/login">Próbáld újra</a>
            `);
        }

        // 3. Sikeres belépés
        req.session.userId = user._id;
        req.session.isAdmin = (email === 'stylefaqu@gmail.com'); // Admin jog beállítása
        
        console.log('Sikeres belépés! Irány a dashboard.');
        res.redirect('/dashboard');

    } catch (err) {
        console.log(err);
        res.send('<h1 style="color:red">SZERVER HIBA: ' + err.message + '</h1>');
    }
});

// --- 6. DASHBOARD (Hibakereső módban) ---
app.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            req.session.destroy();
            return res.redirect('/login');
        }

        // Itt adjuk át az adatokat. Ha a dashboard.ejs hibás, itt fog elszállni.
        res.render('dashboard', { 
            user: user, 
            isAdmin: req.session.isAdmin 
        });

    } catch (err) {
        // HA FEHÉR A KÉPERNYŐ, EZT FOGOD LÁTNI:
        res.send(`
            <h1 style="color:red">DASHBOARD MEGJELENÍTÉSI HIBA</h1>
            <p>A dashboard.ejs fájlban van a hiba.</p>
            <pre>${err.message}</pre>
        `);
    }
});

// Regisztráció
app.post('/auth/register', async (req, res) => {
    const { fullname, email, password } = req.body;
    try {
        const existing = await User.findOne({ email });
        if (existing) return res.send('Ez az email már foglalt. <a href="/regisztracio">Vissza</a>');
        
        const salt = await bcrypt.genSalt(10);
        const hashed = await bcrypt.hash(password, salt);
        const code = 'SKY-' + Math.floor(1000 + Math.random() * 9000);
        
        await new User({ fullname, email, password: hashed, myReferralCode: code }).save();
        res.redirect('/login');
    } catch (err) {
        res.send('Regisztrációs hiba: ' + err.message);
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));