// --- ÚJ ÚTVONAL AZ ADMINHOZ: Pénzügyek és Robot visszajelzés ---
app.get('/admin', async (req, res) => {
    try {
        if (!req.session.userId) return res.redirect('/login');
        const user = await User.findById(req.session.userId);
        if (!user || !user.isAdmin) return res.redirect('/dashboard');

        const users = await User.find().sort({ createdAt: -1 });
        const tips = await Tip.find().sort({ date: -1 }).limit(30);
        
        // PÉNZÜGYI ÖSSZESÍTÉS: Számoljuk ki a licencbevételeket
        // Feltételezzük, hogy egy licenc 49 EUR (ahogy a pricing oldalon van)
        const licensedUsersCount = await User.countDocuments({ hasLicense: true });
        const totalRevenue = licensedUsersCount * 49;

        res.render('admin', { 
            user, 
            users, 
            tips, 
            totalRevenue, 
            licensedUsersCount,
            status: req.query.status // Visszajelzés a robotról
        });
    } catch (err) {
        res.status(500).send("Admin hiba: " + err.message);
    }
});

// Robot indítása javított visszajelzéssel
app.post('/admin/run-robot', async (req, res) => {
    try {
        await runAiRobot(); // Lefuttatja az AI elemzést
        res.redirect('/admin?status=success'); // Visszairányít siker üzenettel
    } catch (e) {
        console.error("Robot hiba:", e);
        res.redirect('/admin?status=error');
    }
});