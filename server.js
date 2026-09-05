// ============================================================
// RailEase - Smart Mobility Platform
// Express + built-in SQLite (node:sqlite) backend
// ============================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// ------------------------------------------------------------
// Minimal .env loader
// ------------------------------------------------------------
function loadEnv(file = '.env') {
    if (!fs.existsSync(file)) return;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (!(key in process.env)) process.env[key] = value;
    }
}
loadEnv();

const PORT = parseInt(process.env.PORT || '3000', 10);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'rail-ease.db');

// ------------------------------------------------------------
// Database setup
// ------------------------------------------------------------
const db = new DatabaseSync(DB_FILE);

db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS stations (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        city TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trains (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        number          TEXT UNIQUE NOT NULL,
        name            TEXT NOT NULL,
        source_code     TEXT NOT NULL REFERENCES stations(code),
        dest_code       TEXT NOT NULL REFERENCES stations(code),
        departure_time  TEXT NOT NULL,
        arrival_time    TEXT NOT NULL,
        duration        TEXT NOT NULL,
        base_fare       REAL NOT NULL,
        seats_available INTEGER NOT NULL,
        status          TEXT NOT NULL DEFAULT 'on_time'
    );

    CREATE TABLE IF NOT EXISTS bookings (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        pnr            TEXT UNIQUE NOT NULL,
        customer_name  TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        train_id       INTEGER NOT NULL REFERENCES trains(id),
        travel_date    TEXT NOT NULL,
        passengers     INTEGER NOT NULL,
        total_fare     REAL NOT NULL,
        status         TEXT NOT NULL DEFAULT 'confirmed',
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

// ------------------------------------------------------------
// Seed data (only if tables are empty)
// ------------------------------------------------------------
function seed() {
    const stationCount = db.prepare('SELECT COUNT(*) AS c FROM stations').get().c;
    if (stationCount === 0) {
        const stations = [
            ['CDG',  'Central Station',    'New York'],
            ['WST',  'Westend Terminal',   'Los Angeles'],
            ['NTH',  'North Junction',     'Chicago'],
            ['SST',  'Southside Terminal', 'Houston'],
            ['EST',  'Eastgate Station',   'Miami'],
            ['INT',  'International Hub',  'San Francisco'],
            ['DPT',  'Depot Yard',         'Seattle'],
            ['RVN',  'Riverside Station',  'New Orleans'],
            ['MTN',  'Mountain View Halt', 'Denver'],
            ['BCH',  'Beachfront Station', 'San Diego']
        ];
        const ins = db.prepare('INSERT INTO stations (code, name, city) VALUES (?, ?, ?)');
        for (const s of stations) ins.run(...s);
    }

    const trainCount = db.prepare('SELECT COUNT(*) AS c FROM trains').get().c;
    if (trainCount === 0) {
        const trains = [
            ['RE101', 'Rapid Express',     'CDG', 'WST', '06:00', '14:30', '8h 30m', 59.00, 320, 'on_time'],
            ['RE215', 'Rapid Express',     'WST', 'CDG', '07:15', '15:45', '8h 30m', 62.00, 140, 'delayed'],
            ['NV303', 'Night Voyager',     'NTH', 'SST', '21:00', '06:30', '9h 30m', 45.50, 210, 'on_time'],
            ['SL412', 'Silver Liner',      'EST', 'BCH', '08:30', '15:00', '6h 30m', 38.00, 0,   'full'],
            ['NE527', 'Northbound Express','CDG', 'NTH', '09:00', '14:45', '5h 45m', 41.25, 95,  'on_time'],
            ['SW609', 'Sunset Wanderer',   'INT', 'MTN', '16:30', '22:15', '5h 45m', 52.75, 175, 'on_time'],
            ['GM718', 'Grand Mountain',    'MTN', 'BCH', '10:00', '19:30', '9h 30m', 71.00, 60,  'delayed'],
            ['HL821', 'Harbor Link',       'RVN', 'EST', '13:45', '18:10', '4h 25m', 27.50, 260, 'on_time'],
            ['FX933', 'Frontier Express',  'DPT', 'INT', '11:20', '20:05', '8h 45m', 64.90, 120, 'on_time'],
            ['SG107', 'Silvergate Shuttle','BCH', 'CDG', '05:45', '12:50', '7h 05m', 56.00, 88,  'on_time']
        ];
        const ins = db.prepare(`INSERT INTO trains
            (number, name, source_code, dest_code, departure_time, arrival_time, duration, base_fare, seats_available, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const t of trains) ins.run(...t);
    }
}
seed();

// ------------------------------------------------------------
// Helpers + Express app
// ------------------------------------------------------------
function generatePNR() {
    return 'RE' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function getStationMap() {
    const rows = db.prepare('SELECT code, name, city FROM stations').all();
    const map = {};
    for (const r of rows) map[r.code] = r.name + ', ' + r.city;
    return map;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ success: true, service: 'RailEase API', time: new Date().toISOString() });
});

// All stations
app.get('/api/stations', (req, res) => {
    const q = (req.query.query || '').trim().toLowerCase();
    let rows;
    if (q) {
        const stmt = db.prepare('SELECT * FROM stations WHERE LOWER(name) LIKE ? OR LOWER(city) LIKE ? OR LOWER(code) LIKE ?');
        rows = stmt.all('%' + q + '%', '%' + q + '%', '%' + q + '%');
    } else {
        rows = db.prepare('SELECT * FROM stations ORDER BY name').all();
    }
    res.json({ success: true, data: rows });
});

// Train search
app.get('/api/trains', (req, res) => {
    const { source, destination } = req.query;
    if (source && destination && source === destination) {
        return res.status(400).json({ success: false, error: 'Source and destination must be different.' });
    }
    if (source || destination) {
        const rows = db.prepare(`
            SELECT t.*, s.name AS source_name, s.city AS source_city,
                   d.name AS dest_name, d.city AS dest_city
            FROM trains t JOIN stations s ON t.source_code = s.code JOIN stations d ON t.dest_code = d.code
            WHERE (s.code = ? OR s.name = ? OR s.city = ?)
              AND (d.code = ? OR d.name = ? OR d.city = ?)
            ORDER BY t.departure_time
        `).all(source||'', source||'', source||'', destination||'', destination||'', destination||'');
        return res.json({ success: true, count: rows.length, data: rows });
    }
    const rows = db.prepare(`
        SELECT t.*, s.name AS source_name, s.city AS source_city,
               d.name AS dest_name, d.city AS dest_city
        FROM trains t JOIN stations s ON t.source_code = s.code JOIN stations d ON t.dest_code = d.code
        ORDER BY t.departure_time
    `).all();
    res.json({ success: true, count: rows.length, data: rows });
});

// Single train by id
app.get('/api/trains/:id', (req, res) => {
    const train = db.prepare(`
        SELECT t.*, s.name AS source_name, s.city AS source_city,
               d.name AS dest_name, d.city AS dest_city
        FROM trains t JOIN stations s ON t.source_code = s.code JOIN stations d ON t.dest_code = d.code
        WHERE t.id = ?
    `).get(req.params.id);
    if (!train) return res.status(404).json({ success: false, error: 'Train not found.' });
    res.json({ success: true, data: train });
});

// Live status
app.get('/api/live-status', (req, res) => {
    const stations = db.prepare('SELECT * FROM stations').all();
    const colors = { LOW: 'emerald', MODERATE: 'orange', HIGH: 'orange', CRITICAL: 'rose' };
    const data = stations.map((s, i) => {
        const seedVal = (s.id * 7919) % 97;
        const base = (i * 23) % 100;
        const congestion = Math.min(97, Math.max(8, (base + seedVal) % 92 + 8));
        let level;
        if (congestion > 85) level = 'CRITICAL';
        else if (congestion > 60) level = 'HIGH';
        else if (congestion > 35) level = 'MODERATE';
        else level = 'LOW';
        return { id: s.id, code: s.code, name: s.name, city: s.city, congestion, level, color: colors[level], lastUpdate: new Date().toISOString() };
    });
    res.json({ success: true, data });
});

// Create booking
app.post('/api/bookings', (req, res) => {
    const { customerName, customerEmail, trainId, travelDate, passengers } = req.body || {};

    if (!customerName || typeof customerName !== 'string' || customerName.trim().length < 2) {
        return res.status(400).json({ success: false, error: 'Please provide a valid full name.' });
    }
    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
        return res.status(400).json({ success: false, error: 'Please provide a valid email address.' });
    }
    const trainIdNum = parseInt(trainId, 10);
    if (!Number.isInteger(trainIdNum) || trainIdNum <= 0) {
        return res.status(400).json({ success: false, error: 'Please select a valid train.' });
    }
    if (!travelDate || isNaN(Date.parse(travelDate))) {
        return res.status(400).json({ success: false, error: 'Please provide a valid travel date.' });
    }
    const travelerCount = parseInt(passengers, 10);
    if (!Number.isInteger(travelerCount) || travelerCount < 1 || travelerCount > 6) {
        return res.status(400).json({ success: false, error: 'Passenger count must be between 1 and 6.' });
    }

    const train = db.prepare('SELECT * FROM trains WHERE id = ?').get(trainIdNum);
    if (!train) return res.status(404).json({ success: false, error: 'Selected train does not exist.' });
    if (train.status === 'full' || train.seats_available < travelerCount) {
        return res.status(409).json({ success: false, error: 'Not enough seats available on this train.' });
    }

    const totalFare = +(train.base_fare * travelerCount).toFixed(2);
    const pnr = generatePNR();

    db.exec('BEGIN');
    try {
        db.prepare(`INSERT INTO bookings (pnr, customer_name, customer_email, train_id, travel_date, passengers, total_fare, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')`).run(pnr, customerName.trim(), customerEmail.trim(), trainIdNum, travelDate, travelerCount, totalFare);
        db.prepare('UPDATE trains SET seats_available = seats_available - ? WHERE id = ?').run(travelerCount, trainIdNum);
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        return res.status(500).json({ success: false, error: 'Could not save booking. Please try again.' });
    }

    const booked = db.prepare(`
        SELECT b.*, t.number AS train_number, t.name AS train_name,
               st.name AS source_name, dt.name AS dest_name,
               st.city AS source_city, dt.city AS dest_city
        FROM bookings b JOIN trains t ON b.train_id = t.id
        JOIN stations st ON t.source_code = st.code JOIN stations dt ON t.dest_code = dt.code
        WHERE b.pnr = ?
    `).get(pnr);
    res.status(201).json({ success: true, message: 'Booking confirmed!', data: booked });
});

// Retrieve booking by PNR
app.get('/api/bookings/pnr/:pnr', (req, res) => {
    const pnr = (req.params.pnr || '').trim().toUpperCase();
    if (!/^RE[A-F0-9]{6}$/.test(pnr)) {
        return res.status(400).json({ success: false, error: 'Invalid PNR format.' });
    }
    const booking = db.prepare(`
        SELECT b.*, t.number AS train_number, t.name AS train_name,
               st.name AS source_name, dt.name AS dest_name,
               st.code AS source_code, dt.code AS dest_code,
               st.city AS source_city, dt.city AS dest_city
        FROM bookings b JOIN trains t ON b.train_id = t.id
        JOIN stations st ON t.source_code = st.code JOIN stations dt ON t.dest_code = dt.code
        WHERE b.pnr = ?
    `).get(pnr);
    if (!booking) return res.status(404).json({ success: false, error: 'No booking found for this PNR.' });
    res.json({ success: true, data: booking });
});

// Catch-all API 404
app.use('/api', (req, res) => {
    res.status(404).json({ success: false, error: 'API endpoint not found.' });
});

// Start server
app.listen(PORT, () => {
    const stationMap = getStationMap();
    console.log('=============================================');
    console.log('  RailEase API running on http://localhost:' + PORT);
    console.log('  DB file : ' + DB_FILE);
    console.log('  Stations: ' + Object.keys(stationMap).length + ' registered');
    console.log('=============================================');
});
