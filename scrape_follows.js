#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const db = require('./database');
const { getUserByUsername, getFollowing } = require('./get_following');

const RATE_LIMIT_DELAY = 2000; // 2 seconds between requests
const CORE_NODES_FILE = path.join(__dirname, 'core_nodes_tshehads.json');
const LOG_FILE = path.join(__dirname, 'logs', 'scrape.log');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Logging helper
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

// Sleep helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Load core nodes from JSON file
function loadCoreNodesFromFile() {
    if (!fs.existsSync(CORE_NODES_FILE)) {
        throw new Error(`Core nodes file not found: ${CORE_NODES_FILE}`);
    }
    const data = JSON.parse(fs.readFileSync(CORE_NODES_FILE, 'utf8'));
    return data.following;
}

// Fetch all following for a user with pagination
async function fetchAllFollowing(userId) {
    const allFollowing = [];
    let cursor = null;
    
    do {
        const result = await getFollowing(userId, cursor);
        
        if (result.list && result.list.length > 0) {
            allFollowing.push(...result.list);
        } else {
            break;
        }
        
        cursor = result.cursor;
        
        if (cursor) {
            await sleep(RATE_LIMIT_DELAY);
        }
    } while (cursor);
    
    return allFollowing;
}

// Process a single core node
async function processCoreNode(node, index, total) {
    const startTime = Date.now();
    
    try {
        // Get or create core node in database
        let coreNode = db.getCoreNodeByTwitterId(node.user_id);
        if (!coreNode) {
            coreNode = db.upsertCoreNode(node);
        }
        
        // Fetch current following list from Twitter
        log(`[${index}/${total}] Scraping @${node.username} (${node.following_count} following)...`);
        const currentFollowing = await fetchAllFollowing(node.user_id);
        
        // Get previously known follows from database
        const previousFollowIds = db.getActiveFollows(coreNode.id);
        const previousFollowIdSet = new Set(previousFollowIds);
        
        // Process each followed user
        let newCount = 0;
        let existingCount = 0;
        const currentFollowIds = [];
        
        for (const followedUser of currentFollowing) {
            // Upsert the followed user to users table
            const user = db.upsertUser(followedUser);
            currentFollowIds.push(user.id);
            
            // Check if this is a new follow
            if (!previousFollowIdSet.has(user.id)) {
                // New follow detected!
                db.addFollow(coreNode.id, user.id);
                db.addNewFollow(coreNode.id, user.id);
                newCount++;
            } else {
                // Existing follow - update last seen
                db.addFollow(coreNode.id, user.id);
                existingCount++;
            }
        }
        
        // Detect unfollows (users in previous but not in current)
        const currentFollowIdSet = new Set(currentFollowIds);
        const unfollowedIds = previousFollowIds.filter(id => !currentFollowIdSet.has(id));
        if (unfollowedIds.length > 0) {
            db.markFollowsInactive(coreNode.id, unfollowedIds);
        }
        
        // Update last scraped timestamp
        db.updateCoreNodeScrapedAt(coreNode.id);
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log(`[${index}/${total}] @${node.username}: ${currentFollowing.length} following, ${newCount} new, ${unfollowedIds.length} unfollowed (${elapsed}s)`);
        
        return { newCount, unfollowedCount: unfollowedIds.length, totalFollowing: currentFollowing.length };
        
    } catch (error) {
        log(`[${index}/${total}] ERROR @${node.username}: ${error.message}`);
        return { newCount: 0, unfollowedCount: 0, totalFollowing: 0, error: error.message };
    }
}

// Main nightly scrape function
async function nightlyScrape() {
    const startTime = Date.now();
    
    log('========================================');
    log('Starting nightly scrape...');
    log('========================================');
    
    // Load core nodes
    const coreNodes = loadCoreNodesFromFile();
    log(`Loaded ${coreNodes.length} core nodes from ${CORE_NODES_FILE}`);
    
    // Process each core node
    let totalNew = 0;
    let totalUnfollowed = 0;
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < coreNodes.length; i++) {
        const node = coreNodes[i];
        const result = await processCoreNode(node, i + 1, coreNodes.length);
        
        if (result.error) {
            errorCount++;
        } else {
            successCount++;
            totalNew += result.newCount;
            totalUnfollowed += result.unfollowedCount;
        }
        
        // Rate limiting between accounts
        if (i < coreNodes.length - 1) {
            await sleep(RATE_LIMIT_DELAY);
        }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    
    log('========================================');
    log(`Nightly scrape complete!`);
    log(`Duration: ${elapsed} minutes`);
    log(`Accounts scraped: ${successCount}/${coreNodes.length}`);
    log(`Errors: ${errorCount}`);
    log(`New follows detected: ${totalNew}`);
    log(`Unfollows detected: ${totalUnfollowed}`);
    log('========================================');
    
    return {
        duration: elapsed,
        successCount,
        errorCount,
        totalNew,
        totalUnfollowed
    };
}

// CLI
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Nightly Follow Scraper

Usage:
  node scrape_follows.js                    # Run full nightly scrape
  node scrape_follows.js --test             # Test with first 3 accounts only
  node scrape_follows.js --user <username>  # Scrape a specific user
  node scrape_follows.js --init             # Initialize core nodes in database only

Options:
  --test           Run a test scrape with only first 3 accounts
  --user <name>    Scrape a specific user by username (without @)
  --init           Load core nodes into database without scraping
  --help           Show this help message
`);
        process.exit(0);
    }
    
    if (args.includes('--init')) {
        log('Initializing core nodes in database...');
        const coreNodes = loadCoreNodesFromFile();
        db.loadCoreNodesFromJson(coreNodes);
        log(`Loaded ${coreNodes.length} core nodes into database`);
        process.exit(0);
    }
    
    // Handle --user <username> flag
    const userIndex = args.indexOf('--user');
    if (userIndex !== -1) {
        const username = args[userIndex + 1];
        if (!username) {
            console.error('Error: --user requires a username argument');
            process.exit(1);
        }
        
        log(`Scraping single user: @${username}`);
        
        // First, look up the user to get their info
        const userInfo = await getUserByUsername(username);
        if (!userInfo) {
            console.error(`Error: User @${username} not found`);
            process.exit(1);
        }
        
        // getUserByUsername returns the legacy object directly
        const node = {
            user_id: userInfo.id_str,
            username: userInfo.screen_name,
            display_name: userInfo.name,
            following_count: userInfo.friends_count,
            followers_count: userInfo.followers_count
        };
        
        // Ensure user is in core_nodes table
        db.upsertCoreNode(node);
        
        await processCoreNode(node, 1, 1);
        log('Single user scrape complete!');
        process.exit(0);
    }
    
    if (args.includes('--test')) {
        log('Running TEST scrape (first 3 accounts only)...');
        const coreNodes = loadCoreNodesFromFile().slice(0, 3);
        
        for (let i = 0; i < coreNodes.length; i++) {
            await processCoreNode(coreNodes[i], i + 1, coreNodes.length);
            if (i < coreNodes.length - 1) await sleep(RATE_LIMIT_DELAY);
        }
        
        log('Test scrape complete!');
        process.exit(0);
    }
    
    // Full scrape
    try {
        await nightlyScrape();
        process.exit(0);
    } catch (error) {
        log(`FATAL ERROR: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { nightlyScrape, processCoreNode };
