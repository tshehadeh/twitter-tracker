#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const db = require('./database');

const CORE_NODES_FILE = path.join(__dirname, 'core_nodes_tshehads.json');

function loadCoreNodes() {
    console.log('Loading core nodes from:', CORE_NODES_FILE);
    
    if (!fs.existsSync(CORE_NODES_FILE)) {
        console.error('Error: Core nodes file not found!');
        console.log('Please run the scraper first to generate core_nodes_tshehads.json');
        process.exit(1);
    }
    
    const data = JSON.parse(fs.readFileSync(CORE_NODES_FILE, 'utf8'));
    
    console.log(`Found ${data.following.length} core nodes`);
    console.log(`Seed user: @${data.seed_user.username}`);
    console.log('');
    
    // Load into database
    console.log('Loading into database...');
    db.loadCoreNodesFromJson(data.following);
    
    // Verify
    const loaded = db.getAllCoreNodes();
    console.log(`Successfully loaded ${loaded.length} core nodes into database`);
    
    // Show sample
    console.log('\nSample core nodes:');
    loaded.slice(0, 5).forEach((node, i) => {
        console.log(`  ${i + 1}. @${node.username} (${node.following_count} following)`);
    });
    console.log('  ...');
    
    console.log('\nDone! You can now run the nightly scraper:');
    console.log('  node scrape_follows.js --test   # Test with first 3 accounts');
    console.log('  node scrape_follows.js          # Full nightly scrape');
}

loadCoreNodes();
