const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');
const User = require('./models/User');

const app = express();

// --- 1. ADATBÁZIS KAPCSOLAT ---
const dbURI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/skyhigh';
mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB SIKERESEN CSATLAKOZTATVA'))
    .catch(err => console.log('❌ FATÁLIS DB HIBA:', err));

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// --- 2. SESSION ---
app.use(session({
    secret: 'director_secret_key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- 3. JOGOSULTSÁGOK ---
const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
        return res.send('<h1 style="color:red">HIBA: Nem vagy bejelentkezve! <a href="/login">Kattints ide a belépéshez</a></h1>');
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.isAdmin) {
        return res.redirect('/dashboard');
    }
    next();
};

// --- 4. ÚTVONALAK ---

// Alap oldalak
app.get('/', (req, res) => res.render('index'));
app.get('/technologia', (req, res) => res.render('tech'));
app.get('/strategia', (req, res) => res.render('profit'));
app.get('/mlm', (req, res) => res.render('mlm'));
app.get('/regisztracio', (req, res) => res.render('register'));
app.get('/login', (req, res) => res.render('login'));

// DEBUG (A te régi kódodból, meghagytam)
app.get('/debug', async (req, res) => {
    try {
        const users = await User.find();
        res.send(`
            <h1>ADATBÁZIS DIAGNOSZTIKA</h1>
            <p>Regisztrált felhasználók: ${users.length}</p>
            <ul>${users.map(u => `<li>${u.email} | Licenc: ${u.hasLicense ? 'AKTÍV' : 'Nincs'}</li>`).join('')}</ul>
            <a href="/login">Vissza</a>
        `);
    } catch (err) { res.send('DB HIBA: ' + err.message); }
});

// AUTH: Login
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.send('Nincs ilyen felhasználó! <a href="/login">Újra</a>');

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.send('Hibás jelszó! <a href="/login">Újra</a>');

        req.session.userId = user._id;
        // ADMIN JOG BEÁLLÍTÁSA:
        req.session.isAdmin = (email === 'stylefaqu@gmail.com'); 
        
        res.redirect('/dashboard');
    } catch (err) { res.send('Hiba: ' + err.message); }
});

// AUTH: Regisztráció
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
    } catch (err) { res.send('Hiba: ' + err.message); }
});

// DASHBOARD
app.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) { req.session.destroy(); return res.redirect('/login'); }
        
        // Ellenőrizzük, lejárt-e a licenc
        if (user.licenseExpires && new Date() > user.licenseExpires) {
            user.hasLicense = false; // Lejárt
            await user.save();
        }

        res.render('dashboard', { user, isAdmin: req.session.isAdmin });
    } catch (err) { res.send('Dashboard Hiba: ' + err.message); }
});

// LOGOUT
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ======================================================
// 💰 FIZETÉSI RENDSZER (ÚJ)
// ======================================================

app.get('/fizetes', requireLogin, (req, res) => res.render('pay'));

app.post('/pay/create-checkout-session', requireLogin, async (req, res) => {
    const { plan } = req.body;
    const user = await User.findById(req.session.userId);
    
    let durationDays = 0;
    let price = 0;
    let type = '';

    // --- AZ ÁRAZÁSI LOGIKA (Amit kértél) ---
    if (plan === 'monthly') {
        durationDays = 30;
        price = 20000;      // 20.000 Ft
        type = 'Havi Licenc';
    } else if (plan === 'biannual') {
        durationDays = 180; // 6 Hónap
        price = 100000;     // 100.000 Ft (Kedvezményes)
        type = 'Féléves Profi Licenc';
    } else if (plan === 'annual') {
        durationDays = 365; // 1 Év
        price = 180000;     // 180.000 Ft (VIP)
        type = 'Éves Befektetői Licenc';
    }

    // --- AUTOMATIKUS AKTIVÁLÁS ---
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + durationDays);

    user.hasLicense = true;           // Bekapcsoljuk
    user.licenseExpires = expiryDate; // Beállítjuk a lejáratot
    user.licenseType = type;
    user.totalSpent = (user.totalSpent || 0) + price; // Hozzáadjuk a bevételhez
    
    await user.save();

    console.log(`💰 FIZETÉS SIKERES: ${user.email} | Összeg: ${price} Ft`);

    // Siker oldalra küldjük
    res.render('pay_success', { plan: type, date: expiryDate.toLocaleDateString() });
});

// ======================================================
// 👑 ADMIN PANEL (ÚJ)
// ======================================================

app.get('/admin', requireLogin, requireAdmin, async (req, res) => {
    const users = await User.find().sort({ date: -1 }); // Legújabb elöl
    res.render('admin', { users });
});

app.get('/admin/activate/:id', requireLogin, requireAdmin, async (req, res) => {
    // Kézi aktiválás (alapból 30 napot ad)
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    await User.findByIdAndUpdate(req.params.id, { 
        hasLicense: true, 
        licenseExpires: expiry,
        licenseType: 'Admin Ajándék'
    });
    res.redirect('/admin');
});

app.get('/admin/deactivate/:id', requireLogin, requireAdmin, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { 
        hasLicense: false,
        licenseExpires: null 
    });
    res.redirect('/admin');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));