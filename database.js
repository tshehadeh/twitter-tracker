const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'tracker.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        twitter_id TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        bio TEXT,
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

// Prepared statements for performance
const statements = {
    insertUser: db.prepare(`
        INSERT OR IGNORE INTO users (twitter_id, username, display_name, bio, verified, followers_count, following_count, profile_image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
               u.bio as followed_bio, u.followers_count as followed_followers,
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
               u.bio as followed_bio, u.followers_count as followed_followers,
               u.following_count as followed_following, u.profile_image_url as followed_avatar,
               u.verified as followed_verified, u.id as followed_user_db_id
        FROM new_follows nf
        JOIN core_nodes cn ON nf.core_node_id = cn.id
        JOIN users u ON nf.followed_user_id = u.id
        LEFT JOIN categorizations c ON u.id = c.user_id
        WHERE nf.reviewed = 0 AND c.id IS NULL
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
               u.bio as followed_bio, u.followers_count as followed_followers,
               u.following_count as followed_following, u.profile_image_url as followed_avatar,
               u.verified as followed_verified, u.id as followed_user_db_id
        FROM new_follows nf
        JOIN core_nodes cn ON nf.core_node_id = cn.id
        JOIN users u ON nf.followed_user_id = u.id
        LEFT JOIN categorizations c ON u.id = c.user_id
        WHERE nf.reviewed = 0 AND c.id IS NULL AND DATE(nf.detected_at) = ?
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
    
    // Bulk load core nodes from JSON
    loadCoreNodesFromJson(nodes) {
        const insertMany = db.transaction((nodeList) => {
            nodeList.forEach(node => {
                this.upsertCoreNode(node);
            });
        });
        insertMany(nodes);
    },
};

module.exports = dbFunctions;
