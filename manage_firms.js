#!/usr/bin/env node

const db = require('./database');
const { getUserByUsername, getFollowing } = require('./get_following');

// Firm definitions with main accounts and bio keywords
const FIRMS = {
    'a16z': {
        name: 'Andreessen Horowitz',
        mainAccounts: ['a16z', 'a16zcrypto', 'a16zgames', 'a16zbio'],
        bioKeywords: [
            'a16z', 'andreessen horowitz', 'andreessen', '@a16z', 
            'a16zcrypto', 'a16zgames', 'a16zbio', 'a16z crypto', 'a16z games', 'a16z bio'
        ],
    },
    '8vc': {
        name: '8VC',
        mainAccounts: ['8vc'],
        bioKeywords: ['8vc', '8 vc', '@8vc', 'eight vc'],
    },
    'sequoia': {
        name: 'Sequoia',
        mainAccounts: ['sequoia'],
        // "sequoia" uses word boundaries - won't match random tree mentions
        bioKeywords: ['sequoia', '@sequoia', 'sequoia capital', 'sequoiacap'],
    },
    'founders': {
        name: 'Founders Fund',
        mainAccounts: ['foundersfund'],
        bioKeywords: ['founders fund', 'foundersfund', '@foundersfund', 'ffvc', 'ff vc'],
    },
    'greylock': {
        name: 'Greylock',
        mainAccounts: ['greylock'],
        bioKeywords: ['greylock', 'greylockpartners', '@greylock', 'greylock partners'],
    },
    'lightspeed': {
        name: 'Lightspeed',
        mainAccounts: ['lightspeedvp'],
        bioKeywords: ['lightspeed venture', 'lightspeed ventures', 'lightspeedvp', '@lightspeedvp', 'lsvp', 'at lightspeed'],
    },
    'accel': {
        name: 'Accel',
        mainAccounts: ['accel'],
        // "accel" now uses word boundaries, won't match "accelerate"
        bioKeywords: ['accel', '@accel', 'accel vc', 'accel ventures', 'accel partners', 'accelpartners'],
    },
    'bessemer': {
        name: 'Bessemer',
        mainAccounts: ['BessemerVP'],
        bioKeywords: ['bessemer', 'bvp', 'bessemervp', '@bessemer', 'bessemer venture'],
    },
    'index': {
        name: 'Index Ventures',
        mainAccounts: ['indexventures'],
        bioKeywords: ['index ventures', 'indexventures', '@indexventures', 'at index ventures', 'partner at index'],
    },
    'thrive': {
        name: 'Thrive Capital',
        mainAccounts: ['thrivecapital'],
        // Keep specific - "thrive" alone is too common
        bioKeywords: ['thrive capital', 'thrivecapital', '@thrivecapital'],
    },
    'general': {
        name: 'General Catalyst',
        mainAccounts: ['gcvp', 'generalcatalyst'],
        bioKeywords: ['general catalyst', 'generalcatalyst', 'gcvp', '@gcvp', 'gc partners'],
    },
    'bain': {
        name: 'Bain Capital Ventures',
        mainAccounts: ['BainCapVC'],
        bioKeywords: ['bain capital', 'baincapital', 'bcv', 'bain capital ventures', '@baincapital'],
    },
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Assign existing core nodes to firms based on username or bio
function assignExistingNodes() {
    console.log('\n📋 Assigning existing core nodes to firms...\n');
    
    const allNodes = db.db.prepare('SELECT * FROM core_nodes').all();
    let assigned = 0;
    
    for (const node of allNodes) {
        for (const [firmId, firm] of Object.entries(FIRMS)) {
            // Check if username matches main accounts
            if (firm.mainAccounts.some(acc => node.username.toLowerCase() === acc.toLowerCase())) {
                db.assignCoreNodeToFirm(node.id, firmId);
                console.log(`✅ @${node.username} → ${firm.name} (main account)`);
                assigned++;
                break;
            }
            
            // Check if username or display_name contains firm keyword (with word boundaries)
            const nameToCheck = node.username + ' ' + (node.display_name || '');
            if (firm.bioKeywords.some(kw => keywordMatches(nameToCheck, kw))) {
                db.assignCoreNodeToFirm(node.id, firmId);
                console.log(`✅ @${node.username} → ${firm.name} (name match)`);
                assigned++;
                break;
            }
        }
    }
    
    console.log(`\n📊 Assigned ${assigned} nodes to firms`);
}

// Check if keyword matches in text using word boundaries for single words
function keywordMatches(text, keyword) {
    const kwLower = keyword.toLowerCase();
    const textLower = text.toLowerCase();
    
    // If keyword starts with @ or contains spaces, use simple includes
    if (kwLower.startsWith('@') || kwLower.includes(' ')) {
        return textLower.includes(kwLower);
    }
    
    // For single words, use word boundary regex to avoid partial matches
    // e.g., "accel" should not match "accelerate"
    const regex = new RegExp(`\\b${kwLower}\\b`, 'i');
    return regex.test(text);
}

// Find employees by searching ALL users in database for firm keywords in bio
async function discoverEmployees(firmId) {
    const firm = FIRMS[firmId];
    if (!firm) {
        console.error(`❌ Unknown firm: ${firmId}`);
        return;
    }
    
    console.log(`\n🔍 Discovering ${firm.name} employees from your database...\n`);
    console.log(`Searching for bios containing: ${firm.bioKeywords.join(', ')}\n`);
    console.log(`(Using word boundaries for single words to avoid partial matches)\n`);
    
    // Search ALL users in the database for bio keywords
    const allUsers = db.db.prepare('SELECT * FROM users WHERE bio IS NOT NULL').all();
    
    const employees = new Map();
    
    for (const user of allUsers) {
        if (firm.bioKeywords.some(kw => keywordMatches(user.bio, kw))) {
            // Skip if already a core node
            const existingNode = db.getCoreNodeByTwitterId(user.twitter_id);
            if (!existingNode) {
                employees.set(user.twitter_id, user);
            }
        }
    }
    
    console.log(`👥 Found ${employees.size} potential employees (not already tracked):\n`);
    
    for (const [twitterId, user] of employees) {
        console.log(`  @${user.username} - ${user.display_name}`);
        console.log(`     ${user.bio?.substring(0, 80)}...`);
        console.log(`     https://x.com/${user.username}\n`);
    }
    
    return Array.from(employees.values());
}

// Add discovered employees as core nodes for a firm
async function addEmployeesToFirm(firmId, addToScrape = false) {
    const firm = FIRMS[firmId];
    if (!firm) {
        console.error(`❌ Unknown firm: ${firmId}`);
        return;
    }
    
    const employees = await discoverEmployees(firmId);
    if (!employees || employees.length === 0) return;
    
    console.log(`\n➕ Adding ${employees.length} employees to ${firm.name}...\n`);
    
    let added = 0;
    for (const emp of employees) {
        // Check if already a core node
        const existing = db.getCoreNodeByTwitterId(emp.twitter_id);
        if (existing) {
            // Just assign to firm if not already
            if (!existing.firm) {
                db.assignCoreNodeToFirm(existing.id, firmId);
                console.log(`🔗 @${emp.username} - assigned to ${firm.name}`);
                added++;
            }
        } else if (addToScrape) {
            // Add as new core node
            db.addCoreNodeWithFirm(
                emp.twitter_id,
                emp.username,
                emp.display_name,
                emp.following_count || 0,
                emp.followers_count || 0,
                firmId
            );
            console.log(`✅ @${emp.username} - added as new core node`);
            added++;
        }
    }
    
    console.log(`\n📊 Added/assigned ${added} employees to ${firm.name}`);
}

// Show firm stats
function showStats() {
    console.log('\n📊 Firm Statistics\n');
    console.log('='.repeat(60));
    
    const firms = db.getFirmsWithCounts();
    
    if (firms.length === 0) {
        console.log('No firms have members yet. Run: node manage_firms.js --assign');
        return;
    }
    
    for (const f of firms) {
        const firmName = FIRMS[f.firm]?.name || f.firm;
        console.log(`\n${firmName} (${f.firm})`);
        console.log(`  Members: ${f.node_count} (${f.active_count} active)`);
        
        const members = db.getCoreNodesByFirm(f.firm);
        members.slice(0, 5).forEach(m => {
            console.log(`    - @${m.username}`);
        });
        if (members.length > 5) {
            console.log(`    ... and ${members.length - 5} more`);
        }
    }
    
    console.log('\n' + '='.repeat(60));
}

// Reset a firm - clear all members and re-add with current matching logic
async function resetFirm(firmId) {
    const firm = FIRMS[firmId];
    if (!firm) {
        console.error(`❌ Unknown firm: ${firmId}`);
        return;
    }
    
    console.log(`\n🔄 Resetting ${firm.name}...\n`);
    
    // Count current members
    const currentMembers = db.getCoreNodesByFirm(firmId);
    console.log(`📊 Current members: ${currentMembers.length}`);
    
    // Clear all firm assignments for this firm
    const cleared = db.db.prepare(`UPDATE core_nodes SET firm = NULL WHERE firm = ?`).run(firmId);
    console.log(`🗑️  Cleared ${cleared.changes} members from ${firm.name}\n`);
    
    // Re-discover and add with new matching logic
    console.log(`🔍 Re-discovering with word boundary matching...\n`);
    await addEmployeesToFirm(firmId, true);
    
    // Show final stats
    const newMembers = db.getCoreNodesByFirm(firmId);
    console.log(`\n✅ Reset complete!`);
    console.log(`   Before: ${currentMembers.length} members`);
    console.log(`   After:  ${newMembers.length} members`);
}

// CLI
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Firm Management Tool

Usage:
  node manage_firms.js --assign              Assign existing core nodes to firms
  node manage_firms.js --discover <firm>     Find employees for a firm
  node manage_firms.js --add <firm>          Add discovered employees as core nodes
  node manage_firms.js --reset <firm>        Clear firm members and re-add with current matching
  node manage_firms.js --stats               Show firm statistics
  node manage_firms.js --list                List all available firms

Examples:
  node manage_firms.js --assign
  node manage_firms.js --discover a16z
  node manage_firms.js --add 8vc
  node manage_firms.js --reset accel         # Fix false positives
  node manage_firms.js --stats
`);
        process.exit(0);
    }
    
    if (args.includes('--list')) {
        console.log('\n📋 Available Firms:\n');
        for (const [id, firm] of Object.entries(FIRMS)) {
            console.log(`  ${id.padEnd(12)} - ${firm.name}`);
        }
        process.exit(0);
    }
    
    if (args.includes('--stats')) {
        showStats();
        process.exit(0);
    }
    
    if (args.includes('--assign')) {
        assignExistingNodes();
        showStats();
        process.exit(0);
    }
    
    const discoverIdx = args.indexOf('--discover');
    if (discoverIdx !== -1) {
        const firmId = args[discoverIdx + 1];
        if (!firmId) {
            console.error('Error: --discover requires a firm ID');
            process.exit(1);
        }
        await discoverEmployees(firmId);
        process.exit(0);
    }
    
    const addIdx = args.indexOf('--add');
    if (addIdx !== -1) {
        const firmId = args[addIdx + 1];
        if (!firmId) {
            console.error('Error: --add requires a firm ID');
            process.exit(1);
        }
        await addEmployeesToFirm(firmId, true);
        process.exit(0);
    }
    
    const resetIdx = args.indexOf('--reset');
    if (resetIdx !== -1) {
        const firmId = args[resetIdx + 1];
        if (!firmId) {
            console.error('Error: --reset requires a firm ID');
            process.exit(1);
        }
        await resetFirm(firmId);
        process.exit(0);
    }
    
    // Default: show stats
    showStats();
}

main().catch(console.error);
