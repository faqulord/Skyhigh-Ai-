const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Főoldal betöltése
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Mock API a "Task" elvégzéséhez (Szimuláció)
app.post('/api/complete-task', (req, res) => {
    const { level } = req.body;
    
    // Itt a logika: Szint alapján mennyi a jutalék
    let reward = 0;
    if(level === 1) reward = 0.50; // LV1 jutalék
    if(level === 2) reward = 1.00; // LV2 jutalék
    if(level === 3) reward = 2.00; // LV3 jutalék
    if(level === 4) reward = 4.00; // LV4 jutalék

    // Késleltetés, mintha dolgozna a szerver
    setTimeout(() => {
        res.json({ success: true, reward: reward, message: "Sikeres optimalizálás!" });
    }, 2000);
});

app.listen(port, () => {
    console.log(`K ETQ Server running on port ${port}`);
});
