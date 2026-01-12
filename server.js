const express = require('express');
const app = express();

app.set('view engine', 'ejs');
app.use(express.static('public'));

app.get('/', (req, res) => { res.render('index'); });
app.get('/technologia', (req, res) => { res.render('tech'); });
app.get('/strategia', (req, res) => { res.render('profit'); });
app.get('/mlm', (req, res) => { res.render('mlm'); });
app.get('/regisztracio', (req, res) => { res.render('register'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log('Skyhigh AI Online'); });