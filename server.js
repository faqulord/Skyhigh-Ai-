const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { OpenAI } = require('openai');
const path = require('path');
const app = express();

// --- TULAJDONOSI KONFIGURÁCIÓ ---
const OWNER_EMAIL = "stylefaqu@gmail.com"; 

// --- ADATMODELL FRISSÍTÉS ---
const User = mongoose.model('User', new mongoose.Schema({
    fullname: String,
    email: { type: String, unique: true, lowercase: true },
    password: String,
    hasLicense: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    startingCapital: { type: Number, default: 0 }, // Itt tároljuk a tőkét
    createdAt: { type: Date, default: Date.now }
}));

const Tip = mongoose.model('Tip', new mongoose.Schema({
    match: String, 
    prediction: String, 
    odds: { type: Number }, // Számként tároljuk a számoláshoz
    reasoning: String,
    profitPercent: { type: Number, default: 0 }, // Napi profit %
    date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}));

// --- MIDDLEWARES ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'skyhigh_neural_quantum_key_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URL }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// --- ÚTVONALAK ---

// Kezdőtőke mentése (Első vásárláskor)
app.post('/user/set-capital', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { capital } = req.body;
    await User.findByIdAndUpdate(req.session.userId, { startingCapital: capital, hasLicense: true });
    res.redirect('/dashboard');
});

// Admin Panel (Most már nem lesz fehér kép!)
app.get('/admin', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId);
    if (!user.isAdmin) return res.redirect('/dashboard');

    const users = await User.find().sort({ createdAt: -1 });
    const tips = await Tip.find().sort({ date: -1 }).limit(30);
    
    res.render('admin', { user, users, tips });
});

// Robot indítása API-n keresztül
app.post('/admin/run-robot', async (req, res) => {
    // Itt hívjuk meg az API-FOOTBALL-t és az OpenAI-t
    // ... (A robot logikája, ami elmenti a Tip-et profitPercenttel)
    res.redirect('/admin');
});

app.listen(process.env.PORT || 8080, () => console.log("🚀 Skyhigh Master Engine Online"));