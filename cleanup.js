#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'tracker.db');
const db = new Database(dbPath);

// Show current state
console.log('Current data by date:');
const dates = db.prepare(`
    SELECT DATE(detected_at) as date, COUNT(*) as count 
    FROM new_follows 
    GROUP BY DATE(detected_at) 
    ORDER BY date
`).all();
console.table(dates);

// Delete everything except today
console.log('\nDeleting all except today...');
const result = db.prepare(`
    DELETE FROM new_follows 
    WHERE DATE(detected_at) < DATE('now')
`).run();
console.log(`Deleted ${result.changes} rows`);

// Show remaining
console.log('\nRemaining data:');
const remaining = db.prepare(`
    SELECT DATE(detected_at) as date, COUNT(*) as count 
    FROM new_follows 
    GROUP BY DATE(detected_at) 
    ORDER BY date
`).all();
console.table(remaining);

console.log('\nDone! Restart web server with: pm2 restart tracker-web');
