const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8080; // Railway-hez igazítva

app.set('view engine', 'ejs');
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.render('index');
});

app.listen(PORT, () => {
    console.log(`Skyhigh.Ai élesítve a ${PORT} porton!`);
});