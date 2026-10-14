#!/usr/bin/env node

const db = require('./database');

// Firm keywords to search for
const FIRM_KEYWORDS = {
    'a16z': ['a16z', 'andreessen', 'horowitz'],
    'sequoia': ['sequoia'],
    'greylock': ['greylock'],
    'founders': ['founders fund'],
    'lightspeed': ['lightspeed'],
    'bessemer': ['bessemer'],
    'index': ['index ventures'],
    'accel': ['accel'],
    'thrive': ['thrive capital'],
    '8vc': ['8vc'],
    'general': ['general catalyst'],
    'bain': ['bain capital ventures', 'bcv'],
};

const firmArg = process.argv[2]?.toLowerCase() || 'a16z';

// Find matching keywords
let keywords = FIRM_KEYWORDS[firmArg];
if (!keywords) {
    // Use the arg itself as keyword
    keywords = [firmArg];
}

console.log(`\n🔍 Finding employees for: ${firmArg}`);
console.log(`📝 Searching bios for: ${keywords.join(', ')}\n`);

// Build the WHERE clause
const whereClauses = keywords.map(() => `LOWER(bio) LIKE ?`).join(' OR ');
const params = keywords.map(k => `%${k.toLowerCase()}%`);

const users = db.db.prepare(`
    SELECT * FROM users 
    WHERE ${whereClauses}
    ORDER BY followers_count DESC
`).all(...params);

console.log(`👥 Found ${users.length} people:\n`);
console.log('='.repeat(80));

users.forEach((u, i) => {
    console.log(`\n${i + 1}. @${u.username} - ${u.display_name}`);
    console.log(`   🔗 https://x.com/${u.username}`);
    console.log(`   👥 ${u.followers_count?.toLocaleString() || 0} followers`);
    console.log(`   📝 ${u.bio?.substring(0, 120)}${u.bio?.length > 120 ? '...' : ''}`);
});

console.log('\n' + '='.repeat(80));
console.log(`\n📋 Quick list (copy/paste):\n`);
users.forEach(u => console.log(`https://x.com/${u.username}`));

console.log('\n✅ Done!\n');
