#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            if (key && valueParts.length > 0) {
                process.env[key.trim()] = valueParts.join('=').trim();
            }
        }
    });
}

// Config - mirrors OLDTWITTER_CONFIG
const CONFIG = {
    public_token: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
    csrf: process.env.CSRF_TOKEN,
    auth_token: process.env.AUTH_TOKEN,
    twid: process.env.TWID,
};

const RATE_LIMIT_DELAY = 2000; // 2 seconds between requests

// Replicate browser fetch with credentials: "include"
function fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        
        // Build cookie string (this is what credentials: "include" does in browser)
        const cookies = [
            `ct0=${CONFIG.csrf}`,
            `auth_token=${CONFIG.auth_token}`,
            CONFIG.twid ? `twid=${CONFIG.twid}` : null,
        ].filter(Boolean).join('; ');

        const req = https.request({
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Cookie': cookies,
                ...options.headers,
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    json: () => Promise.resolve(JSON.parse(data)),
                });
            });
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
            'x-csrf-token': CONFIG.csrf,
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
    
    // Extract expanded URL from entities
    const expandedUrl = result.legacy.entities?.url?.urls?.[0]?.expanded_url;
    if (expandedUrl) {
        result.legacy.url = expandedUrl;
    }
    
    return result.legacy;
}

// Get one page of following (100 users max) - GraphQL version
function getFollowing(id, cursor) {
    return new Promise((resolve, reject) => {
        const variables = {
            userId: id,
            count: 100,
            includePromotedContent: false,
        };
        if (cursor) variables.cursor = cursor;

        const features = {
            rweb_lists_timeline_redesign_enabled: false,
            responsive_web_graphql_exclude_directive_enabled: true,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            tweetypie_unmention_optimization_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: false,
            tweet_awards_web_tipping_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: true,
            responsive_web_media_download_video_enabled: false,
            responsive_web_enhance_cards_enabled: false,
        };

        const url = `https://x.com/i/api/graphql/t-BPOrMIduGUJWO_LxcvNQ/Following?variables=${encodeURIComponent(
            JSON.stringify(variables)
        )}&features=${encodeURIComponent(JSON.stringify(features))}`;

        fetch(url, {
            headers: {
                authorization: CONFIG.public_token,
                "x-csrf-token": CONFIG.csrf,
                "x-twitter-auth-type": "OAuth2Session",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
        })
            .then((i) => i.json())
            .then((data) => {
                if (data.errors && data.errors[0]) {
                    if (data.errors[0].code === 32) {
                        return reject(new Error("Not logged in"));
                    }
                    return reject(new Error(data.errors[0].message));
                }

                // Parse GraphQL response structure
                const instructions = data.data.user.result.timeline.timeline.instructions;
                const addEntries = instructions.find((i) => i.type === "TimelineAddEntries");
                
                if (!addEntries || !addEntries.entries) {
                    return resolve({ list: [], cursor: null });
                }

                const entries = addEntries.entries;
                
                // Extract users from entries
                const list = entries
                    .filter((e) => e.entryId.startsWith("user-"))
                    .map((e) => {
                        const user = e.content?.itemContent?.user_results?.result;
                        if (!user || !user.legacy) return null;
                        
                        user.legacy.id_str = user.rest_id;
                        if (user.is_blue_verified && !user.legacy.verified_type) {
                            user.legacy.verified = true;
                            user.legacy.verified_type = "Blue";
                        }
                        // Extract expanded URL from entities (the t.co link is in legacy.url)
                        const expandedUrl = user.legacy.entities?.url?.urls?.[0]?.expanded_url;
                        if (expandedUrl) {
                            user.legacy.url = expandedUrl;
                        }
                        return user.legacy;
                    })
                    .filter((e) => e);

                // Find cursor for next page
                const cursorEntry = entries.find((e) => e.entryId.startsWith("cursor-bottom-"));
                const nextCursor = cursorEntry?.content?.value || null;

                resolve({
                    list,
                    cursor: nextCursor,
                });
            })
            .catch((e) => {
                reject(e);
            });
    });
}

// Get ALL following with pagination and rate limiting
async function getAllFollowing(username, maxPages = null) {
    console.log(`Getting following list for @${username}...`);
    
    // Step 1: Get user data
    const userData = await getUserByUsername(username);
    const userId = userData.id_str;
    
    console.log(`Found: @${userData.screen_name} (${userData.name})`);
    console.log(`User ID: ${userId}`);
    console.log(`Following: ${userData.friends_count}`);
    console.log('');
    
    // Step 2: Paginate through all following (100 per page)
    let allFollowing = [];
    let cursor = null;
    let pageCount = 0;
    
    do {
        pageCount++;
        console.log(`Fetching page ${pageCount}${cursor ? ` (cursor: ${cursor.substring(0, 15)}...)` : ''}...`);
        
        const result = await getFollowing(userId, cursor);
        
        if (result.list && result.list.length > 0) {
            allFollowing = allFollowing.concat(result.list);
            console.log(`  Added ${result.list.length} users. Total: ${allFollowing.length}/${userData.friends_count}`);
        } else {
            console.log('  No more users found.');
            break;
        }
        
        cursor = result.cursor;
        
        // Rate limiting delay between requests
        if (cursor) {
            console.log(`  Waiting ${RATE_LIMIT_DELAY / 1000}s for rate limiting...`);
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
        }
        
        // Check page limit
        if (maxPages && pageCount >= maxPages) {
            console.log(`  Reached max pages limit (${maxPages})`);
            break;
        }
        
    } while (cursor);
    
    console.log(`\n=== RESULTS ===`);
    console.log(`@${userData.screen_name} follows ${allFollowing.length} people:\n`);
    
    allFollowing.forEach((user, i) => {
        const verified = user.verified ? ' ✓' : '';
        const blue = user.verified_type === 'Blue' ? ' 🔵' : '';
        console.log(`${i + 1}. @${user.screen_name} - ${user.name}${verified}${blue}`);
    });
    
    return {
        user: userData,
        following: allFollowing,
        totalFetched: allFollowing.length,
        totalActual: userData.friends_count,
    };
}

// Main
async function main() {
    const username = process.argv[2];
    const maxPages = process.argv[3] ? parseInt(process.argv[3]) : null;
    
    if (!username) {
        console.log('Usage: node get_following.js <username> [max_pages]');
        console.log('Examples:');
        console.log('  node get_following.js tshehads        # Get all following');
        console.log('  node get_following.js tshehads 3      # Get first 3 pages (300 users)');
        process.exit(1);
    }

    console.log('Config:');
    console.log(`  AUTH_TOKEN: ${CONFIG.auth_token ? CONFIG.auth_token.substring(0, 10) + '...' : 'NOT SET'}`);
    console.log(`  CSRF_TOKEN: ${CONFIG.csrf ? CONFIG.csrf.substring(0, 10) + '...' : 'NOT SET'}`);
    console.log(`  TWID: ${CONFIG.twid || 'NOT SET'}`);
    console.log('');

    try {
        const result = await getAllFollowing(username, maxPages);
        console.log(`\nDone! Fetched ${result.totalFetched}/${result.totalActual} following.`);
    } catch (error) {
        console.error(`Failed: ${error}`);
        process.exit(1);
    }
}

// Export for use as module
module.exports = { getUserByUsername, getFollowing, getAllFollowing };

// Run CLI if called directly
if (require.main === module) {
    main();
}
