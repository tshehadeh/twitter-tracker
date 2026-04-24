#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const { URL } = require('url');
const crypto = require('crypto');

// Load environment variables from .env file
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            if (key && valueParts.length > 0) {
                process.env[key.trim()] = valueParts.join('=').trim();
            }
        }
    });
}

// CSRF Token Management
const CSRF_TOKEN_FILE = '.csrf_token';
const CSRF_TOKEN_EXPIRY_HOURS = 24;

function generateCt0() {
    const randomNum = Math.floor(Math.random() * 100000);
    const randomStr = randomNum.toString();
    
    // Using Node.js crypto module
    const hash = crypto.createHash('md5').update(randomStr).digest('hex');
    
    return hash;
}

function getCsrfToken() {
    try {
        // Check if token file exists and is recent
        if (fs.existsSync(CSRF_TOKEN_FILE)) {
            const stats = fs.statSync(CSRF_TOKEN_FILE);
            const now = new Date();
            const tokenAge = (now - stats.mtime) / (1000 * 60 * 60); // hours
            
            if (tokenAge < CSRF_TOKEN_EXPIRY_HOURS) {
                const token = fs.readFileSync(CSRF_TOKEN_FILE, 'utf8').trim();
                console.log(`🔄 Using existing CSRF token (${tokenAge.toFixed(1)}h old)`);
                return token;
            }
        }
        
        // Generate new token
        const newToken = generateCt0();
        fs.writeFileSync(CSRF_TOKEN_FILE, newToken);
        console.log(`🆕 Generated new CSRF token: ${newToken}`);
        return newToken;
        
    } catch (error) {
        console.log(`⚠️  Error managing CSRF token: ${error.message}`);
        // Fallback to environment variable or generate new one
        return process.env.CSRF_TOKEN || generateCt0();
    }
}

// Configuration - Uses environment variables from .env
const CONFIG = {
    public_token: `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`,
    csrf_token: process.env.CSRF_TOKEN || getCsrfToken(),
    auth_token: process.env.AUTH_TOKEN,
    twid: process.env.TWID,
};
//a87ff679a2f3e71d9181a67b7542122c
//4a364910a29622f243d97770f34d02404e3dfb1615d6b81cec01dadbc69c68c47541945132314f234ec3517c06c8d3950f29bd591f81ff719f8b988786c93f6299070982fcb5f54a5f40179bbff1b8b2
// Enhanced fetch with cookie support
function fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        
        // Build cookie string
        let cookies = `ct0=${CONFIG.csrf_token}`;
        if (CONFIG.auth_token && CONFIG.auth_token !== "YOUR_AUTH_TOKEN_HERE") {
            cookies += `; auth_token=${CONFIG.auth_token}`;
        }
        if (CONFIG.twid) {
            cookies += `; twid=${CONFIG.twid}`;
        }
        
        const requestOptions = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': 'https://x.com/',
                'Origin': 'https://x.com',
                'Cookie': cookies,
                ...options.headers
            }
        };

        const req = https.request(requestOptions, (res) => {
            let data = '';
            
            // Handle gzip compression
            const stream = res.headers['content-encoding'] === 'gzip' ? 
                require('zlib').createGunzip() : res;
            
            if (res.headers['content-encoding'] === 'gzip') {
                res.pipe(stream);
            } else {
                stream = res;
            }
            
            stream.on('data', (chunk) => data += chunk);
            stream.on('end', () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    headers: res.headers,
                    json: () => {
                        try {
                            return Promise.resolve(JSON.parse(data));
                        } catch (e) {
                            console.log(`❌ JSON parse error. Status: ${res.statusCode}, Data: ${data.substring(0, 200)}...`);
                            throw e;
                        }
                    }
                });
            });
            
            stream.on('error', reject);
        });

        req.on('error', reject);
        req.end();
    });
}

// Convert username to user ID
async function getUserByUsername(username) {
    const cleanUsername = username.replace('@', '');
    
    const url = `https://x.com/i/api/graphql/sLVLhk0bGj3MVFEKTdax1w/UserByScreenName?variables=%7B%22screen_name%22%3A%22${cleanUsername}%22%2C%22withSafetyModeUserFields%22%3Atrue%2C%22withSuperFollowsUserFields%22%3Atrue%7D&features=${encodeURIComponent(
        JSON.stringify({
            blue_business_profile_image_shape_enabled: true,
            responsive_web_graphql_exclude_directive_enabled: true,
            verified_phone_label_enabled: false,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            responsive_web_graphql_timeline_navigation_enabled: true,
        })
    )}`;
    
    const response = await fetch(url, {
        headers: {
            'authorization': CONFIG.public_token,
            'x-csrf-token': CONFIG.csrf_token,
            'x-twitter-auth-type': 'OAuth2Session',
            'content-type': 'application/json',
            'x-twitter-client-language': 'en'
        }
    });
    
    const data = await response.json();
    
    if (data.errors && data.errors[0]) {
        throw new Error(data.errors[0].message);
    }
    if (data.data.user.result.unavailable_message) {
        throw new Error(data.data.user.result.unavailable_message.text);
    }

    let result = data.data.user.result;
    result.legacy.id_str = result.rest_id;
    
    return result.legacy;
}

// Get following list by user ID
function getFollowing(id, cursor) {
    return new Promise((resolve, reject) => {
        fetch(
            `https://twitter.com/i/api/1.1/friends/list.json?include_followed_by=1&user_id=${id}&count=100${
                cursor ? `&cursor=${cursor}` : ""
            }`,
            {
                headers: {
                    authorization: CONFIG.public_token,
                    "x-csrf-token": CONFIG.csrf_token,
                    "x-twitter-auth-type": "OAuth2Session",
                    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                },
            }
        )
            .then((response) => {
                console.log(`📡 Response status: ${response.status}`);
                return response.json();
            })
            .then((data) => {
                console.log(`📦 Data keys: ${Object.keys(data || {}).join(', ')}`);
                if (data.errors && data.errors[0]) {
                    console.log(`❌ API Error: ${JSON.stringify(data.errors)}`);
                    return reject(data.errors[0].message);
                }
                resolve({
                    list: data.users,
                    cursor:
                        data.next_cursor_str !== "0"
                            ? data.next_cursor_str
                            : null,
                });
            })
            .catch((e) => {
                console.log(`💥 Catch error: ${e.message || e}`);
                reject(e);
            });
    });
}

// Main function: Get following list by username
async function getFollowingByUsername(username, maxPages = null, maxUsers = null) {
    const cleanUsername = username.replace('@', '');
    console.log(`🐦 Getting following list for @${cleanUsername}...`);
    
    try {
        // Step 1: Convert username to user ID
        console.log(`🔍 Step 1: Converting @${cleanUsername} to user ID...`);
        const userData = await getUserByUsername(username);
        const userId = userData.id_str;
        
        console.log(`✅ Found user: @${userData.screen_name} (${userData.name})`);
        console.log(`📊 User ID: ${userId}`);
        console.log(`👥 Following ${userData.friends_count} accounts`);
        console.log(`📈 ${userData.followers_count} followers`);
        
        // Calculate optimal limits
        const totalFollowing = userData.friends_count;
        
        // Try to get all users in one request if possible
        let actualMaxPages = maxPages;
        let actualMaxUsers = maxUsers || totalFollowing; // Default to exact following count
        
        if (maxPages && maxUsers) {
            // Use the more restrictive limit
            const maxUsersFromPages = maxPages * 100;
            actualMaxUsers = Math.min(maxUsers, maxUsersFromPages);
            actualMaxPages = Math.min(maxPages, Math.ceil(actualMaxUsers / 100));
        } else if (maxPages) {
            actualMaxUsers = maxPages * 100;
        } else if (!maxUsers) {
            // No limits specified - try to get all following
            actualMaxUsers = totalFollowing;
            actualMaxPages = Math.ceil(totalFollowing / 100); // Allow enough pages
        }
        
        const estimatedPages = Math.ceil(actualMaxUsers / 100);
        
        console.log(`🎯 Optimization: Max ${actualMaxPages || 'unlimited'} pages, Max ${actualMaxUsers || 'unlimited'} users`);
        
        // Step 2: Get following list with optimized calls
        console.log(`\n🔍 Step 2: Getting following list (optimized)...`);
        
        let allFollowing = [];
        let cursor = null;
        let page = 0;
        let remainingUsers = actualMaxUsers;
        
        do {
            page++;
            console.log(`📄 Fetching page ${page}${cursor ? ` (cursor: ${cursor.substring(0, 20)}...)` : ''}...`);
            
            // Calculate how many users to request this page
            let usersThisPage = remainingUsers || 100; // Request exact remaining count
            if (remainingUsers !== null) {
                usersThisPage = Math.min(remainingUsers, 100); // Don't exceed 100 per request
                if (usersThisPage <= 0) break;
            }
            
            const result = await getFollowing(userId, cursor);
            
            if (result.list.length === 0) {
                console.log('⚠️  No more following found');
                break;
            }
            
            allFollowing = allFollowing.concat(result.list);
            cursor = result.cursor;
            
            // Update remaining users count
            if (remainingUsers !== null) {
                remainingUsers -= result.list.length;
            }
            
            console.log(`✅ Page ${page}: ${result.list.length} following (total: ${allFollowing.length}${remainingUsers !== null ? `, remaining: ${remainingUsers}` : ''})`);
            
            // Rate limiting
            if (cursor) {
                console.log('⏱️  Waiting 0.5 seconds...');
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Check limits
            if (actualMaxPages && page >= actualMaxPages) {
                console.log(`🛑 Stopped at ${actualMaxPages} pages limit`);
                break;
            }
            
            if (actualMaxUsers && allFollowing.length >= actualMaxUsers) {
                console.log(`🛑 Stopped at ${actualMaxUsers} users limit`);
                break;
            }
            
        } while (cursor && (actualMaxUsers === null || remainingUsers > 0));
        
        // Prepare output
        const output = {
            targetUser: {
                username: userData.screen_name,
                userId: userData.id_str,
                displayName: userData.name,
                verified: userData.verified || false,
                followersCount: userData.followers_count,
                followingCount: userData.friends_count,
                bio: userData.description || '',
                profileUrl: `https://twitter.com/${userData.screen_name}`
            },
            totalFollowing: allFollowing.length,
            totalFollowingActual: totalFollowing,
            completionRate: totalFollowing > 0 ? ((allFollowing.length / totalFollowing) * 100).toFixed(1) : '0',
            extractedAt: new Date().toISOString(),
            pages: page,
            limits: {
                maxPages: actualMaxPages,
                maxUsers: actualMaxUsers,
                estimatedPages: estimatedPages
            },
            following: allFollowing.map(user => ({
                id: user.id_str,
                username: user.screen_name,
                displayName: user.name,
                bio: user.description || '',
                verified: user.verified || false,
                followersCount: user.followers_count,
                followingCount: user.friends_count,
                profileUrl: `https://twitter.com/${user.screen_name}`
            }))
        };
        
        // Save to file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const filename = `following_${cleanUsername}_${timestamp}.json`;
        
        fs.writeFileSync(filename, JSON.stringify(output, null, 2));
        
        console.log(`\n🎉 Complete! Found ${allFollowing.length}/${totalFollowing} accounts (${output.completionRate}%) across ${page} pages`);
        console.log(`💾 Saved to: ${filename}`);
        
        return output;
        
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        throw error;
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const username = args[0];
    const maxPages = args[1] ? parseInt(args[1]) : null;
    
    if (!username) {
        console.log(`
🐦 Twitter Following Extractor (Optimized Version)

Usage:
  node local_username_following.js <USERNAME> [max_pages]

Examples:
  AUTH_TOKEN=abc123 node local_username_following.js elonmusk        # Get all following
  AUTH_TOKEN=abc123 node local_username_following.js elonmusk 3      # Get first 3 pages

Features:
  🎯 Smart API Management: Automatically optimizes requests based on user's following count
  📊 Completion Tracking: Shows percentage of following list scraped
  ⚡ Efficient Calls: Minimizes API requests while maximizing data collection
  📈 Progress Monitoring: Real-time updates on scraping progress

Environment Variables:
  AUTH_TOKEN=...    # Required: Get from browser cookies (auth_token value)
  CSRF_TOKEN=...    # Optional: Auto-generated if not provided (refreshes every 24h)
  TWID=...          # Optional: Get from browser cookies (twid value)

💡 To get cookies:
  1. Open Twitter/X in browser while logged in
  2. DevTools → Application → Cookies 
  3. Copy 'auth_token' value (CSRF token is auto-generated)

🚀 Optimized for efficiency - minimizes API calls while maximizing data collection!
        `);
        process.exit(1);
    }
    
    if (!CONFIG.auth_token || CONFIG.auth_token === "YOUR_AUTH_TOKEN_HERE") {
        console.error('❌ Error: AUTH_TOKEN environment variable required');
        console.log('💡 Get auth_token from browser cookies');
        process.exit(1);
    }
    
    try {
        await getFollowingByUsername(username, maxPages);
    } catch (error) {
        console.error(`💥 Failed: ${error.message}`);
        process.exit(1);
    }
}

// Export for use as module
module.exports = { getFollowingByUsername, getUserByUsername };

// Run if called directly
if (require.main === module) {
    main();
} 