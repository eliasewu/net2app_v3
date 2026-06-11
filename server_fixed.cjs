const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static files from dist
app.use(express.static(path.join(__dirname, 'dist')));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API endpoints
app.get('/api/clients', (req, res) => {
    res.json({ 
        success: true, 
        data: [
            { client_code: 'CL_TRIANGLE_TRADE', company_name: 'Tri Angle Trade Centre FZE LLC', max_tps: 100, status: 'active' },
            { client_code: 'CL_TRIANGLE_VOICE', company_name: 'Tri Angle Voice Services', max_tps: 75, status: 'active' }
        ]
    });
});

app.get('/api/mccmnc', (req, res) => {
    res.json({ success: true, data: [], count: 0 });
});

app.get('/api/mccmnc/stats/summary', (req, res) => {
    res.json({ 
        success: true, 
        statistics: {
            total_records: 0,
            total_countries: 0,
            total_mccs: 0,
            active_records: 0
        }
    });
});

// For SPA routing - serve index.html for non-API routes
app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    } else {
        next();
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
    console.log(`   Open http://146.59.47.22:${PORT} in your browser`);
});
