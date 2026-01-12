const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');
const User = require('./models/User'); // Betöltjük a modellt

const app = express();

// Adatbázis kapcsolat (Railway)
const dbURI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/skyhigh';
mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB Csatlakoztatva'))
    .catch(err => console.log('❌ DB Hiba:', err));

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Session
app.use(session({
    secret: 'secret_key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURI })
}));

// Útvonalak
app.get('/', (req, res) => res.render('index'));
app.get('/technologia', (req, res) => res.render('tech'));
app.get('/strategia', (req, res) => res.render('profit'));
app.get('/mlm', (req, res) => res.render('mlm'));
app.get('/regisztracio', (req, res) => res.render('register'));

// Regisztráció logikája
app.post('/auth/register', async (req, res) => {
    const { fullname, email, password } = req.body;
    try {
        const existing = await User.findOne({ email });
        if (existing) return res.send('Ez az email már foglalt. <a href="/regisztracio">Vissza</a>');

        const salt = await bcrypt.genSalt(10);
        const hashed = await bcrypt.hash(password, salt);
        const code = 'SKY-' + Math.floor(1000 + Math.random() * 9000);

        await new User({ fullname, email, password: hashed, myReferralCode: code }).save();
        
        res.send(`
            <body style="background:black; color:white; text-align:center; padding-top:50px; font-family:sans-serif;">
                <h1 style="color:#22c55e;">Sikeres Regisztráció!</h1>
                <p>Üdvözöllek, ${fullname}!</p>
                <p>Az MLM Kódod: <strong>${code}</strong></p>
                <a href="/" style="color:#aaa;">Vissza a Főoldalra</a>
            </body>
        `);
    } catch (err) {
        console.log(err);
        res.send('Hiba történt.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));