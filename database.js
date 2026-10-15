const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'tracker.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        twitter_id TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        bio TEXT,
        url TEXT,
        verified INTEGER DEFAULT 0,
        followers_count INTEGER DEFAULT 0,
        following_count INTEGER DEFAULT 0,
        profile_image_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed_username TEXT NOT NULL,
        seed_user_id TEXT,
        total_following INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_users (
        session_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (session_id, user_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS categorizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('outbound', 'track', 'pass')),
        session_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_categorizations_user ON categorizations(user_id);
    CREATE INDEX IF NOT EXISTS idx_categorizations_category ON categorizations(category);
    CREATE INDEX IF NOT EXISTS idx_session_users_session ON session_users(session_id);

    -- Core nodes we're monitoring (loaded from JSON)
    CREATE TABLE IF NOT EXISTS core_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        twitter_id TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        following_count INTEGER DEFAULT 0,
        followers_count INTEGER DEFAULT 0,
        last_scraped_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        outbound_count INTEGER DEFAULT 0,
        track_count INTEGER DEFAULT 0,
        pass_count INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        firm TEXT DEFAULT NULL
    );

    -- Historical follows (who follows whom)
    CREATE TABLE IF NOT EXISTS follows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        core_node_id INTEGER NOT NULL,
        followed_user_id INTEGER NOT NULL,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1,
        UNIQUE(core_node_id, followed_user_id),
        FOREIGN KEY (core_node_id) REFERENCES core_nodes(id),
        FOREIGN KEY (followed_user_id) REFERENCES users(id)
    );

    -- New follows detected (the daily diff)
    CREATE TABLE IF NOT EXISTS new_follows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        core_node_id INTEGER NOT NULL,
        followed_user_id INTEGER NOT NULL,
        detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed INTEGER DEFAULT 0,
        category TEXT CHECK(category IN ('outbound', 'track', 'pass', NULL)),
        FOREIGN KEY (core_node_id) REFERENCES core_nodes(id),
        FOREIGN KEY (followed_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_core_nodes_twitter_id ON core_nodes(twitter_id);
    CREATE INDEX IF NOT EXISTS idx_follows_core_node ON follows(core_node_id);
    CREATE INDEX IF NOT EXISTS idx_follows_active ON follows(is_active);
    CREATE INDEX IF NOT EXISTS idx_new_follows_reviewed ON new_follows(reviewed);
    CREATE INDEX IF NOT EXISTS idx_new_follows_detected ON new_follows(detected_at);
`);

// Migration: Add new columns to core_nodes if they don't exist
try {
    db.exec(`ALTER TABLE core_nodes ADD COLUMN outbound_count INTEGER DEFAULT 0`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE core_nodes ADD COLUMN track_count INTEGER DEFAULT 0`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE core_nodes ADD COLUMN pass_count INTEGER DEFAULT 0`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE core_nodes ADD COLUMN is_active INTEGER DEFAULT 1`);
} catch (e) { /* Column already exists */ }
try {
    db.exec(`ALTER TABLE core_nodes ADD COLUMN firm TEXT DEFAULT NULL`);
} catch (e) { /* Column already exists */ }

// Migration: Add url column to users if it doesn't exist
try {
    db.exec(`ALTER TABLE users ADD COLUMN url TEXT`);
} catch (e) { /* Column already exists */ }

// Prepared statements for performance
const statements = {
    insertUser: db.prepare(`
        INSERT INTO users (twitter_id, username, display_name, bio, url, verified, followers_count, following_count, profile_image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(twitter_id) DO UPDATE SET
            username = excluded.username,
            display_name = excluded.display_name,
            bio = excluded.bio,
            url = excluded.url,
            verified = excluded.verified,
            followers_count = excluded.followers_count,
            following_count = excluded.following_count,
            profile_image_url = excluded.profile_image_url
    `),
    
    getUserByTwitterId: db.prepare(`SELECT * FROM users WHERE twitter_id = ?`),
    
    getUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
    
    createSession: db.prepare(`
        INSERT INTO sessions (seed_username, seed_user_id, total_following)
        VALUES (?, ?, ?)
    `),
    
    getSession: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
    
    getAllSessions: db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC`),
    
    addSessionUser: db.prepare(`
        INSERT OR IGNORE INTO session_users (session_id, user_id, position)
        VALUES (?, ?, ?)
    `),
    
    categorizeUser: db.prepare(`
        INSERT INTO categorizations (user_id, category, session_id)
        VALUES (?, ?, ?)
    `),
    
    getUserCategorization: db.prepare(`
        SELECT * FROM categorizations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
    `),
    
    getCategorizedUsers: db.prepare(`
        SELECT u.*, c.category, c.created_at as categorized_at
        FROM users u
        JOIN categorizations c ON u.id = c.user_id
        WHERE c.category = ?
        ORDER BY c.created_at DESC
    `),
    
    getSessionStats: db.prepare(`
        SELECT 
            s.total_following,
            (SELECT COUNT(*) FROM session_users WHERE session_id = s.id) as fetched_count,
            (SELECT COUNT(*) FROM session_users su2 
             JOIN categorizations c ON su2.user_id = c.user_id 
             WHERE su2.session_id = s.id) as reviewed_count,
            (SELECT COUNT(*) FROM session_users su3 
             LEFT JOIN categorizations c2 ON su3.user_id = c2.user_id 
             WHERE su3.session_id = s.id AND c2.id IS NULL) as remaining_count
        FROM sessions s
        WHERE s.id = ?
    `),
    
    getCategoryCounts: db.prepare(`
        SELECT category, COUNT(*) as count
        FROM categorizations
        GROUP BY category
    `),
    
    // Core nodes statements
    insertCoreNode: db.prepare(`
        INSERT INTO core_nodes (twitter_id, username, display_name, following_count, followers_count)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(twitter_id) DO UPDATE SET
            username = excluded.username,
            display_name = excluded.display_name,
            following_count = excluded.following_count,
            followers_count = excluded.followers_count
    `),
    
    getCoreNodeByTwitterId: db.prepare(`SELECT * FROM core_nodes WHERE twitter_id = ?`),
    
    getAllCoreNodes: db.prepare(`SELECT * FROM core_nodes ORDER BY username`),
    
    updateCoreNodeScrapedAt: db.prepare(`
        UPDATE core_nodes SET last_scraped_at = CURRENT_TIMESTAMP WHERE id = ?
    `),
    
    // Follows statements
    insertFollow: db.prepare(`
        INSERT OR IGNORE INTO follows (core_node_id, followed_user_id)
        VALUES (?, ?)
    `),
    
    updateFollowSeen: db.prepare(`
        UPDATE follows SET last_seen_at = CURRENT_TIMESTAMP, is_active = 1 
        WHERE core_node_id = ? AND followed_user_id = ?
    `),
    
    getActiveFollows: db.prepare(`
        SELECT followed_user_id FROM follows 
        WHERE core_node_id = ? AND is_active = 1
    `),
    
    markFollowsInactive: db.prepare(`
        UPDATE follows SET is_active = 0 
        WHERE core_node_id = ? AND followed_user_id = ?
    `),
    
    // New follows statements
    insertNewFollow: db.prepare(`
        INSERT INTO new_follows (core_node_id, followed_user_id)
        VALUES (?, ?)
    `),
    
    getUnreviewedNewFollows: db.prepare(`
        SELECT nf.*, 
               cn.username as core_node_username, cn.display_name as core_node_display_name,
               u.username as followed_username, u.display_name as followed_display_name,
               u.bio as followed_bio, u.url as followed_url, u.followers_count as followed_followers,
               u.following_count as followed_following, u.profile_image_url as followed_avatar,
               u.verified as followed_verified, u.id as followed_user_db_id
        FROM new_follows nf
        JOIN core_nodes cn ON nf.core_node_id = cn.id
        JOIN users u ON nf.followed_user_id = u.id
        WHERE nf.reviewed = 0
        ORDER BY nf.detected_at DESC
    `),
    
    getNextUnreviewedNewFollow: db.prepare(`
        SELECT nf.*, 
               cn.username as core_node_username, cn.display_name as core_node_display_name,
               u.username as followed_username, u.display_name as followed_display_name,
               u.bio as followed_bio, u.url as followed_url, u.followers_count as followed_followers,
               u.following_count as followed_following, u.profile_image_url as followed_avatar,
               u.verified as followed_verified, u.id as followed_user_db_id,
               c.category as existing_category
        FROM new_follows nf
        JOIN core_nodes cn ON nf.core_node_id = cn.id
        JOIN users u ON nf.followed_user_id = u.id
        LEFT JOIN categorizations c ON u.id = c.user_id
        WHERE nf.reviewed = 0
        ORDER BY nf.detected_at DESC
        LIMIT 1
    `),
    
    categorizeNewFollow: db.prepare(`
        UPDATE new_follows SET reviewed = 1, category = ? WHERE id = ?
    `),
    
    getNewFollowsStats: db.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END) as unreviewed,
            SUM(CASE WHEN category = 'outbound' THEN 1 ELSE 0 END) as outbound,
            SUM(CASE WHEN category = 'track' THEN 1 ELSE 0 END) as track,
            SUM(CASE WHEN category = 'pass' THEN 1 ELSE 0 END) as pass
        FROM new_follows
    `),
    
    getNewFollowsByDate: db.prepare(`
        SELECT DATE(detected_at) as date, 
               COUNT(*) as count,
               SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END) as unreviewed
        FROM new_follows
        GROUP BY DATE(detected_at)
        ORDER BY date DESC
        LIMIT 30
    `),
    
    getNextUnreviewedNewFollowByDate: db.prepare(`
        SELECT nf.*, 
               cn.username as core_node_username, cn.display_name as core_node_display_name,
               u.username as followed_username, u.display_name as followed_display_name,
               u.bio as followed_bio, u.url as followed_url, u.followers_count as followed_followers,
               u.following_count as followed_following, u.profile_image_url as followed_avatar,
               u.verified as followed_verified, u.id as followed_user_db_id,
               c.category as existing_category
        FROM new_follows nf
        JOIN core_nodes cn ON nf.core_node_id = cn.id
        JOIN users u ON nf.followed_user_id = u.id
        LEFT JOIN categorizations c ON u.id = c.user_id
        WHERE nf.reviewed = 0 AND DATE(nf.detected_at) = ?
        ORDER BY nf.detected_at DESC
        LIMIT 1
    `),
    
    getStatsByDate: db.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END) as unreviewed
        FROM new_follows
        WHERE DATE(detected_at) = ?
    `),
    
    // Grouped new follows - aggregated by followed user, sorted by follow count
    getGroupedNewFollowsByDate: db.prepare(`
        SELECT 
            u.id as user_id,
            u.twitter_id,
            u.username,
            u.display_name,
            u.bio,
            u.followers_count,
            u.following_count,
            u.profile_image_url,
            u.verified,
            COUNT(DISTINCT cn.id) as follow_count,
            GROUP_CONCAT(DISTINCT cn.username) as followed_by_usernames,
            GROUP_CONCAT(DISTINCT cn.id) as followed_by_ids,
            GROUP_CONCAT(nf.id) as new_follow_ids,
            MIN(nf.detected_at) as first_detected
        FROM new_follows nf
        JOIN users u ON nf.followed_user_id = u.id
        JOIN core_nodes cn ON nf.core_node_id = cn.id
        LEFT JOIN categorizations c ON u.id = c.user_id
        WHERE nf.reviewed = 0 AND c.id IS NULL AND DATE(nf.detected_at) = ?
        GROUP BY nf.followed_user_id
        ORDER BY follow_count DESC, u.followers_count DESC
    `),
    
    getGroupedNewFollowsStats: db.prepare(`
        SELECT 
            COUNT(DISTINCT nf.followed_user_id) as unique_users,
            COUNT(nf.id) as total_follows,
            SUM(CASE WHEN nf.reviewed = 0 THEN 1 ELSE 0 END) as unreviewed
        FROM new_follows nf
        LEFT JOIN categorizations c ON nf.followed_user_id = c.user_id
        WHERE nf.reviewed = 0 AND c.id IS NULL AND DATE(nf.detected_at) = ?
    `),
    
    // Mark all new_follows for a user as reviewed
    categorizeNewFollowsByUserId: db.prepare(`
        UPDATE new_follows 
        SET reviewed = 1, category = ? 
        WHERE followed_user_id = ? AND reviewed = 0
    `),
};

// Database functions
const dbFunctions = {
    // Insert a user (or get existing)
    upsertUser(twitterUser) {
        statements.insertUser.run(
            twitterUser.id_str || twitterUser.twitter_id,
            twitterUser.screen_name || twitterUser.username,
            twitterUser.name || twitterUser.display_name,
            twitterUser.description || twitterUser.bio || '',
            twitterUser.url || twitterUser.website || '',
            twitterUser.verified ? 1 : 0,
            twitterUser.followers_count || 0,
            twitterUser.friends_count || twitterUser.following_count || 0,
            twitterUser.profile_image_url_https || twitterUser.profile_image_url || ''
        );
        
        const user = statements.getUserByTwitterId.get(twitterUser.id_str || twitterUser.twitter_id);
        return user;
    },
    
    // Create a new session
    createSession(seedUsername, seedUserId, totalFollowing) {
        const result = statements.createSession.run(seedUsername, seedUserId, totalFollowing);
        return result.lastInsertRowid;
    },
    
    // Get session by ID
    getSession(sessionId) {
        return statements.getSession.get(sessionId);
    },
    
    // Get all sessions
    getAllSessions() {
        return statements.getAllSessions.all();
    },
    
    // Add user to session
    addSessionUser(sessionId, userId, position) {
        statements.addSessionUser.run(sessionId, userId, position);
    },
    
    // Bulk add users to session
    addUsersToSession(sessionId, twitterUsers) {
        const insertMany = db.transaction((users) => {
            users.forEach((twitterUser, index) => {
                const user = this.upsertUser(twitterUser);
                this.addSessionUser(sessionId, user.id, index);
            });
        });
        insertMany(twitterUsers);
    },
    
    // Categorize a user
    categorizeUser(userId, category, sessionId) {
        statements.categorizeUser.run(userId, category, sessionId);
    },
    
    // Check if user is already categorized
    isUserCategorized(userId) {
        const cat = statements.getUserCategorization.get(userId);
        return cat !== undefined;
    },
    
    // Get next uncategorized user for a session
    getNextUncategorizedUser(sessionId) {
        const stmt = db.prepare(`
            SELECT u.*, su.position
            FROM session_users su
            JOIN users u ON su.user_id = u.id
            LEFT JOIN categorizations c ON u.id = c.user_id
            WHERE su.session_id = ? AND c.id IS NULL
            ORDER BY su.position ASC
            LIMIT 1
        `);
        return stmt.get(sessionId);
    },
    
    // Get all users in a category
    getCategorizedUsers(category) {
        return statements.getCategorizedUsers.all(category);
    },
    
    // Get session stats
    getSessionStats(sessionId) {
        const stats = statements.getSessionStats.get(sessionId);
        return stats || { total_following: 0, reviewed_count: 0 };
    },
    
    // Get category counts
    getCategoryCounts() {
        const rows = statements.getCategoryCounts.all();
        const counts = { outbound: 0, track: 0, pass: 0 };
        rows.forEach(row => {
            counts[row.category] = row.count;
        });
        return counts;
    },
    
    // Get user by ID
    getUserById(userId) {
        return statements.getUserById.get(userId);
    },
    
    // ============================================
    // CORE NODES FUNCTIONS
    // ============================================
    
    // Insert or update a core node
    upsertCoreNode(node) {
        statements.insertCoreNode.run(
            node.user_id || node.twitter_id,
            node.username,
            node.display_name,
            node.following_count || 0,
            node.followers_count || 0
        );
        return statements.getCoreNodeByTwitterId.get(node.user_id || node.twitter_id);
    },
    
    // Get all core nodes
    getAllCoreNodes() {
        return statements.getAllCoreNodes.all();
    },
    
    // Get core node by twitter ID
    getCoreNodeByTwitterId(twitterId) {
        return statements.getCoreNodeByTwitterId.get(twitterId);
    },
    
    // Update last scraped timestamp
    updateCoreNodeScrapedAt(coreNodeId) {
        statements.updateCoreNodeScrapedAt.run(coreNodeId);
    },
    
    // ============================================
    // FOLLOWS FUNCTIONS
    // ============================================
    
    // Get active follows for a core node (returns array of user IDs)
    getActiveFollows(coreNodeId) {
        const rows = statements.getActiveFollows.all(coreNodeId);
        return rows.map(r => r.followed_user_id);
    },
    
    // Add or update a follow relationship
    addFollow(coreNodeId, followedUserId) {
        statements.insertFollow.run(coreNodeId, followedUserId);
        statements.updateFollowSeen.run(coreNodeId, followedUserId);
    },
    
    // Mark follows as inactive (unfollowed)
    markFollowsInactive(coreNodeId, userIds) {
        const markInactive = db.transaction((ids) => {
            ids.forEach(userId => {
                statements.markFollowsInactive.run(coreNodeId, userId);
            });
        });
        markInactive(userIds);
    },
    
    // ============================================
    // NEW FOLLOWS FUNCTIONS
    // ============================================
    
    // Add a new follow detection
    addNewFollow(coreNodeId, followedUserId) {
        statements.insertNewFollow.run(coreNodeId, followedUserId);
    },
    
    // Get all unreviewed new follows
    getUnreviewedNewFollows() {
        return statements.getUnreviewedNewFollows.all();
    },
    
    // Get next unreviewed new follow (skipping already categorized users)
    getNextUnreviewedNewFollow() {
        return statements.getNextUnreviewedNewFollow.get();
    },
    
    // Categorize a new follow
    categorizeNewFollow(newFollowId, category) {
        statements.categorizeNewFollow.run(category, newFollowId);
    },
    
    // Get new follows stats
    getNewFollowsStats() {
        return statements.getNewFollowsStats.get() || {
            total: 0, unreviewed: 0, outbound: 0, track: 0, pass: 0
        };
    },
    
    // Get new follows grouped by date
    getNewFollowsByDate() {
        return statements.getNewFollowsByDate.all();
    },
    
    // Get next unreviewed new follow for a specific date
    getNextUnreviewedNewFollowByDate(date) {
        return statements.getNextUnreviewedNewFollowByDate.get(date);
    },
    
    // Get stats for a specific date
    getStatsByDate(date) {
        return statements.getStatsByDate.get(date) || { total: 0, unreviewed: 0 };
    },
    
    // Get grouped new follows for a date (sorted by follow count)
    getGroupedNewFollowsByDate(date) {
        const results = statements.getGroupedNewFollowsByDate.all(date);
        return results.map(row => ({
            ...row,
            followed_by_usernames: row.followed_by_usernames ? row.followed_by_usernames.split(',') : [],
            followed_by_ids: row.followed_by_ids ? row.followed_by_ids.split(',').map(Number) : [],
            new_follow_ids: row.new_follow_ids ? row.new_follow_ids.split(',').map(Number) : []
        }));
    },
    
    // Get grouped stats for a date
    getGroupedNewFollowsStats(date) {
        return statements.getGroupedNewFollowsStats.get(date) || { unique_users: 0, total_follows: 0, unreviewed: 0 };
    },
    
    // Categorize all new follows for a specific user (and update core node counters)
    categorizeNewFollowsByUserId(userId, category) {
        // First increment counters for all core nodes who had this user in unreviewed new_follows
        this.incrementCountersForFollowedUser(userId, category);
        
        // Then mark as reviewed
        return statements.categorizeNewFollowsByUserId.run(category, userId);
    },
    
    // Bulk load core nodes from JSON
    loadCoreNodesFromJson(nodes) {
        const insertMany = db.transaction((nodeList) => {
            nodeList.forEach(node => {
                this.upsertCoreNode(node);
            });
        });
        insertMany(nodes);
    },
    
    // Get new follows for a specific firm (by firm field)
    getNewFollowsByFirm(firmId) {
        return db.prepare(`
            SELECT nf.*, 
                   cn.username as core_node_username, cn.display_name as core_node_display_name,
                   cn.firm as core_node_firm,
                   u.username as followed_username, u.display_name as followed_display_name,
                   u.bio as followed_bio, u.url as followed_url, u.followers_count as followed_followers,
                   u.following_count as followed_following, u.profile_image_url as followed_avatar,
                   u.verified as followed_verified, u.id as followed_user_db_id,
                   c.category as existing_category
            FROM new_follows nf
            JOIN core_nodes cn ON nf.core_node_id = cn.id
            JOIN users u ON nf.followed_user_id = u.id
            LEFT JOIN categorizations c ON u.id = c.user_id
            WHERE cn.firm = ?
            ORDER BY nf.detected_at DESC
        `).all(firmId);
    },
    
    // Get new follows for a specific member (core_node_id)
    getNewFollowsByMember(coreNodeId) {
        return db.prepare(`
            SELECT nf.*, 
                   cn.username as core_node_username, cn.display_name as core_node_display_name,
                   cn.firm as core_node_firm,
                   u.username as followed_username, u.display_name as followed_display_name,
                   u.bio as followed_bio, u.url as followed_url, u.followers_count as followed_followers,
                   u.following_count as followed_following, u.profile_image_url as followed_avatar,
                   u.verified as followed_verified, u.id as followed_user_db_id,
                   c.category as existing_category
            FROM new_follows nf
            JOIN core_nodes cn ON nf.core_node_id = cn.id
            JOIN users u ON nf.followed_user_id = u.id
            LEFT JOIN categorizations c ON u.id = c.user_id
            WHERE nf.core_node_id = ?
            ORDER BY nf.detected_at DESC
        `).all(coreNodeId);
    },
    
    // Get next unreviewed new follow for a firm
    getNextNewFollowByFirm(firmId) {
        return db.prepare(`
            SELECT nf.*, 
                   cn.username as core_node_username, cn.display_name as core_node_display_name,
                   cn.firm as core_node_firm,
                   u.username as followed_username, u.display_name as followed_display_name,
                   u.bio as followed_bio, u.url as followed_url, u.followers_count as followed_followers,
                   u.following_count as followed_following, u.profile_image_url as followed_avatar,
                   u.verified as followed_verified, u.id as followed_user_db_id,
                   c.category as existing_category
            FROM new_follows nf
            JOIN core_nodes cn ON nf.core_node_id = cn.id
            JOIN users u ON nf.followed_user_id = u.id
            LEFT JOIN categorizations c ON u.id = c.user_id
            WHERE nf.reviewed = 0 AND cn.firm = ?
            ORDER BY nf.detected_at DESC
            LIMIT 1
        `).get(firmId);
    },
    
    // Get core nodes by firm (with bio from users table if available)
    getCoreNodesByFirm(firmId) {
        return db.prepare(`
            SELECT cn.*, u.bio 
            FROM core_nodes cn
            LEFT JOIN users u ON cn.twitter_id = u.twitter_id
            WHERE cn.firm = ? AND cn.is_active = 1
            ORDER BY cn.followers_count DESC
        `).all(firmId);
    },
    
    // Get all firms with counts
    getFirmsWithCounts() {
        return db.prepare(`
            SELECT 
                firm,
                COUNT(*) as node_count,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
            FROM core_nodes 
            WHERE firm IS NOT NULL
            GROUP BY firm
            ORDER BY node_count DESC
        `).all();
    },
    
    // Assign a core node to a firm
    assignCoreNodeToFirm(coreNodeId, firmId) {
        return db.prepare(`UPDATE core_nodes SET firm = ? WHERE id = ?`).run(firmId, coreNodeId);
    },
    
    // Assign core node to firm by username
    assignCoreNodeToFirmByUsername(username, firmId) {
        return db.prepare(`UPDATE core_nodes SET firm = ? WHERE LOWER(username) = LOWER(?)`).run(firmId, username);
    },
    
    // Remove core node from firm (set firm to null)
    removeCoreNodeFromFirm(coreNodeId) {
        return db.prepare(`UPDATE core_nodes SET firm = NULL WHERE id = ?`).run(coreNodeId);
    },
    
    // Add a new core node with firm
    addCoreNodeWithFirm(twitterId, username, displayName, followingCount, followersCount, firmId) {
        return db.prepare(`
            INSERT INTO core_nodes (twitter_id, username, display_name, following_count, followers_count, firm)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(twitter_id) DO UPDATE SET
                username = excluded.username,
                display_name = excluded.display_name,
                following_count = excluded.following_count,
                followers_count = excluded.followers_count,
                firm = excluded.firm
        `).run(twitterId, username, displayName, followingCount, followersCount, firmId);
    },
    
    // Increment core node category counter
    incrementCoreNodeCounter(coreNodeId, category) {
        const column = `${category}_count`;
        db.prepare(`UPDATE core_nodes SET ${column} = ${column} + 1 WHERE id = ?`).run(coreNodeId);
    },
    
    // Increment counters for all core nodes who followed a user
    incrementCountersForFollowedUser(followedUserId, category) {
        // Find all core_nodes who have this user in their new_follows
        const coreNodes = db.prepare(`
            SELECT DISTINCT core_node_id FROM new_follows WHERE followed_user_id = ?
        `).all(followedUserId);
        
        const column = `${category}_count`;
        coreNodes.forEach(cn => {
            db.prepare(`UPDATE core_nodes SET ${column} = ${column} + 1 WHERE id = ?`).run(cn.core_node_id);
        });
        
        return coreNodes.length;
    },
    
    // Stop tracking a core node
    stopTrackingCoreNode(coreNodeId) {
        db.prepare(`UPDATE core_nodes SET is_active = 0 WHERE id = ?`).run(coreNodeId);
    },
    
    // Resume tracking a core node
    resumeTrackingCoreNode(coreNodeId) {
        db.prepare(`UPDATE core_nodes SET is_active = 1 WHERE id = ?`).run(coreNodeId);
    },
    
    // Get core node by ID with stats
    getCoreNodeWithStats(coreNodeId) {
        return db.prepare(`
            SELECT *, 
                   (outbound_count + track_count + pass_count) as total_categorized,
                   CASE WHEN (outbound_count + track_count + pass_count) > 0 
                        THEN ROUND(100.0 * track_count / (outbound_count + track_count + pass_count), 1)
                        ELSE 0 END as track_rate,
                   CASE WHEN (outbound_count + track_count + pass_count) > 0 
                        THEN ROUND(100.0 * pass_count / (outbound_count + track_count + pass_count), 1)
                        ELSE 0 END as pass_rate
            FROM core_nodes WHERE id = ?
        `).get(coreNodeId);
    },
    
    // Get core node by username (with bio from users table)
    getCoreNodeByUsername(username) {
        return db.prepare(`
            SELECT cn.*, 
                   u.bio,
                   (cn.outbound_count + cn.track_count + cn.pass_count) as total_categorized,
                   CASE WHEN (cn.outbound_count + cn.track_count + cn.pass_count) > 0 
                        THEN ROUND(100.0 * cn.track_count / (cn.outbound_count + cn.track_count + cn.pass_count), 1)
                        ELSE 0 END as track_rate,
                   CASE WHEN (cn.outbound_count + cn.track_count + cn.pass_count) > 0 
                        THEN ROUND(100.0 * cn.pass_count / (cn.outbound_count + cn.track_count + cn.pass_count), 1)
                        ELSE 0 END as pass_rate
            FROM core_nodes cn
            LEFT JOIN users u ON cn.twitter_id = u.twitter_id
            WHERE LOWER(cn.username) = LOWER(?)
        `).get(username);
    },
    
    // Get all core nodes with stats (for leaderboard)
    getAllCoreNodesWithStats() {
        return db.prepare(`
            SELECT *, 
                   (outbound_count + track_count + pass_count) as total_categorized,
                   CASE WHEN (outbound_count + track_count + pass_count) > 0 
                        THEN ROUND(100.0 * track_count / (outbound_count + track_count + pass_count), 1)
                        ELSE 0 END as track_rate,
                   CASE WHEN (outbound_count + track_count + pass_count) > 0 
                        THEN ROUND(100.0 * pass_count / (outbound_count + track_count + pass_count), 1)
                        ELSE 0 END as pass_rate
            FROM core_nodes 
            ORDER BY total_categorized DESC
        `).all();
    },

    // Get next unreviewed new follow for a firm
    getNextNewFollowByFirm(keywords) {
        const whereClauses = keywords.map(() => `LOWER(cn.username) LIKE ? OR LOWER(cn.display_name) LIKE ?`).join(' OR ');
        const params = keywords.flatMap(k => [`%${k.toLowerCase()}%`, `%${k.toLowerCase()}%`]);
        
        const query = `
            SELECT nf.*, 
                   cn.username as core_node_username, cn.display_name as core_node_display_name,
                   u.username as followed_username, u.display_name as followed_display_name,
                   u.bio as followed_bio, u.url as followed_url, u.followers_count as followed_followers,
                   u.following_count as followed_following, u.profile_image_url as followed_avatar,
                   u.verified as followed_verified, u.id as followed_user_db_id,
                   c.category as existing_category
            FROM new_follows nf
            JOIN core_nodes cn ON nf.core_node_id = cn.id
            JOIN users u ON nf.followed_user_id = u.id
            LEFT JOIN categorizations c ON u.id = c.user_id
            WHERE nf.reviewed = 0 AND (${whereClauses})
            ORDER BY nf.detected_at DESC
            LIMIT 1
        `;
        
        return db.prepare(query).get(...params);
    },
};

// Export the raw db connection for custom queries
dbFunctions.db = db;

module.exports = dbFunctions;
