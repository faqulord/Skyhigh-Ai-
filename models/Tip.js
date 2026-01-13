const mongoose = require('mongoose');

const TipSchema = new mongoose.Schema({
    date: { type: String, required: true },
    match: { type: String, required: true },
    prediction: { type: String, required: true },
    odds: { type: String, required: true },
    reasoning: { type: String, required: true },
    league: { type: String, default: 'Egyéb' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Tip', TipSchema);