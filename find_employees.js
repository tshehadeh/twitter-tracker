#!/usr/bin/env node

const db = require('./database');

// Firm to search
const FIRM_NAME = process.argv[2] || 'a16z';

// Keywords to search for in bios (case-insensitive)
const KEYWORDS = [
    'a16z', 'andreessen', 'horowitz',
    // Add more as needed
];

console.log(`\n🔍 Finding ${FIRM_NAME} employees...\n`);

// First, find the firm's Twitter account in core_nodes
const firmNode = db.db.prepare(`
    SELECT * FROM core_nodes 
    WHERE LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?
`).get(`%${FIRM_NAME.toLowerCase()}%`, `%${FIRM_NAME.toLowerCase()}%`);

if (firmNode) {
    console.log(`📌 Found firm account: @${firmNode.username} (${firmNode.display_name})\n`);
    
    // Get all users the firm follows
    const following = db.db.prepare(`
        SELECT u.* FROM users u
        JOIN follows f ON f.followed_user_id = u.id
        WHERE f.core_node_id = ? AND f.is_active = 1
        ORDER BY u.followers_count DESC
    `).all(firmNode.id);
    
    console.log(`📊 @${firmNode.username} follows ${following.length} accounts\n`);
    
    // Filter for likely employees (bio contains firm name)
    const employees = following.filter(u => {
        if (!u.bio) return false;
        const bioLower = u.bio.toLowerCase();
        return KEYWORDS.some(k => bioLower.includes(k.toLowerCase()));
    });
    
    console.log(`👥 Found ${employees.length} likely employees:\n`);
    console.log('='.repeat(80));
    
    employees.forEach((u, i) => {
        console.log(`\n${i + 1}. @${u.username} - ${u.display_name}`);
        console.log(`   🔗 https://x.com/${u.username}`);
        console.log(`   👥 ${u.followers_count?.toLocaleString() || 0} followers`);
        console.log(`   📝 ${u.bio?.substring(0, 100)}${u.bio?.length > 100 ? '...' : ''}`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log(`\n📋 Quick list of Twitter links:\n`);
    employees.forEach(u => console.log(`https://x.com/${u.username}`));
    
} else {
    console.log(`❌ No firm account found for "${FIRM_NAME}" in your core nodes.`);
    console.log(`\nSearching ALL users in database with "${FIRM_NAME}" in their bio...\n`);
    
    // Search all users
    const pattern = `%${FIRM_NAME.toLowerCase()}%`;
    const users = db.db.prepare(`
        SELECT * FROM users 
        WHERE LOWER(bio) LIKE ?
        ORDER BY followers_count DESC
        LIMIT 100
    `).all(pattern);
    
    console.log(`Found ${users.length} users with "${FIRM_NAME}" in bio:\n`);
    
    users.forEach((u, i) => {
        console.log(`${i + 1}. @${u.username} - ${u.display_name}`);
        console.log(`   🔗 https://x.com/${u.username}`);
        console.log(`   👥 ${u.followers_count?.toLocaleString() || 0} followers`);
        console.log(`   📝 ${u.bio?.substring(0, 100)}${u.bio?.length > 100 ? '...' : ''}`);
        console.log('');
    });
}

console.log('\n✅ Done!\n');
