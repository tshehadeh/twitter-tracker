const express = require('express');
const path = require('path');
const db = require('./database');
const { getUserByUsername, getFollowing } = require('./get_following');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store active scraping jobs
const activeJobs = new Map();

// Extract username from X/Twitter URL
function extractUsername(input) {
    const urlMatch = input.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/);
    if (urlMatch) {
        return urlMatch[1];
    }
    return input.replace('@', '');
}

// API: Get all sessions
app.get('/api/sessions', (req, res) => {
    try {
        const sessions = db.getAllSessions();
        res.json({ sessions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Create new session (start scraping)
app.post('/api/session', async (req, res) => {
    const { input } = req.body;
    
    if (!input) {
        return res.status(400).json({ error: 'Input (URL or username) required' });
    }
    
    const username = extractUsername(input);
    
    try {
        // Get user info first
        console.log(`Looking up @${username}...`);
        const userData = await getUserByUsername(username);
        
        // Create session
        const sessionId = db.createSession(
            userData.screen_name,
            userData.id_str,
            userData.friends_count
        );
        
        console.log(`Created session ${sessionId} for @${userData.screen_name}`);
        
        // Start background scraping
        scrapeInBackground(sessionId, userData);
        
        res.json({
            sessionId,
            user: {
                username: userData.screen_name,
                displayName: userData.name,
                followingCount: userData.friends_count,
                followersCount: userData.followers_count,
            },
            message: 'Session created, scraping started in background'
        });
        
    } catch (error) {
        console.error(`Error creating session: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Background scraping function
async function scrapeInBackground(sessionId, userData) {
    const jobInfo = {
        status: 'running',
        progress: 0,
        total: userData.friends_count,
        error: null,
    };
    activeJobs.set(sessionId, jobInfo);
    
    try {
        let cursor = null;
        let pageCount = 0;
        let totalFetched = 0;
        
        do {
            pageCount++;
            console.log(`Session ${sessionId}: Fetching page ${pageCount}...`);
            
            const result = await getFollowing(userData.id_str, cursor);
            
            if (result.list && result.list.length > 0) {
                // Add users to database
                db.addUsersToSession(sessionId, result.list);
                totalFetched += result.list.length;
                jobInfo.progress = totalFetched;
                
                console.log(`Session ${sessionId}: Added ${result.list.length} users (total: ${totalFetched})`);
            } else {
                break;
            }
            
            cursor = result.cursor;
            
            // Rate limiting
            if (cursor) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
        } while (cursor);
        
        jobInfo.status = 'completed';
        console.log(`Session ${sessionId}: Scraping completed (${totalFetched} users)`);
        
    } catch (error) {
        jobInfo.status = 'error';
        jobInfo.error = error.message;
        console.error(`Session ${sessionId}: Scraping error - ${error.message}`);
    }
}

// API: Get session info and scraping status
app.get('/api/session/:id', (req, res) => {
    const sessionId = parseInt(req.params.id);
    
    try {
        const session = db.getSession(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        const job = activeJobs.get(sessionId);
        const stats = db.getSessionStats(sessionId);
        
        res.json({
            session,
            scrapeStatus: job ? job.status : 'completed',
            scrapeProgress: job ? job.progress : stats.total_following,
            stats,
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get next uncategorized user for a session
app.get('/api/session/:id/next', (req, res) => {
    const sessionId = parseInt(req.params.id);
    
    try {
        const user = db.getNextUncategorizedUser(sessionId);
        const stats = db.getSessionStats(sessionId);
        
        if (!user) {
            return res.json({ 
                user: null, 
                message: 'All users reviewed',
                stats 
            });
        }
        
        res.json({ user, stats });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get session stats
app.get('/api/session/:id/stats', (req, res) => {
    const sessionId = parseInt(req.params.id);
    
    try {
        const stats = db.getSessionStats(sessionId);
        const job = activeJobs.get(sessionId);
        const counts = db.getCategoryCounts();
        
        res.json({
            ...stats,
            scrapeStatus: job ? job.status : 'completed',
            scrapeProgress: job ? job.progress : stats.total_following,
            counts,
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Categorize a user
app.post('/api/categorize', (req, res) => {
    const { userId, category, sessionId } = req.body;
    
    if (!userId || !category) {
        return res.status(400).json({ error: 'userId and category required' });
    }
    
    if (!['outbound', 'track', 'pass'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
    }
    
    try {
        db.categorizeUser(userId, category, sessionId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get categorized users
app.get('/api/categorized/:category', (req, res) => {
    const { category } = req.params;
    
    if (!['outbound', 'track', 'pass'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
    }
    
    try {
        const users = db.getCategorizedUsers(category);
        const counts = db.getCategoryCounts();
        res.json({ users, counts });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get all category counts
app.get('/api/counts', (req, res) => {
    try {
        const counts = db.getCategoryCounts();
        res.json(counts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// FIRM DEFINITIONS
// ============================================
const FIRMS = {
    'a16z': { name: 'Andreessen Horowitz' },
    '8vc': { name: '8VC' },
    'sequoia': { name: 'Sequoia' },
    'founders': { name: 'Founders Fund' },
    'greylock': { name: 'Greylock' },
    'lightspeed': { name: 'Lightspeed' },
    'accel': { name: 'Accel' },
    'bessemer': { name: 'Bessemer' },
    'index': { name: 'Index Ventures' },
    'thrive': { name: 'Thrive Capital' },
    'general': { name: 'General Catalyst' },
    'bain': { name: 'Bain Capital Ventures' },
};

// ============================================
// NEW FOLLOWS API ROUTES
// ============================================

// API: Get list of firms (with member counts from database)
app.get('/api/firms', (req, res) => {
    try {
        const firmsFromDb = db.getFirmsWithCounts();
        const firms = Object.entries(FIRMS).map(([id, data]) => {
            const dbData = firmsFromDb.find(f => f.firm === id) || { node_count: 0, active_count: 0 };
            return { 
                id, 
                ...data, 
                memberCount: dbData.node_count,
                activeCount: dbData.active_count
            };
        });
        res.json({ firms });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get members of a firm
app.get('/api/firms/:firmId/members', (req, res) => {
    const { firmId } = req.params;
    const firm = FIRMS[firmId];
    
    if (!firm) {
        return res.status(404).json({ error: 'Firm not found' });
    }
    
    try {
        const members = db.getCoreNodesByFirm(firmId);
        res.json({ firm: { id: firmId, ...firm }, members });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Add a member to a firm
app.post('/api/firms/:firmId/members', (req, res) => {
    const { firmId } = req.params;
    const { username } = req.body;
    
    if (!FIRMS[firmId]) {
        return res.status(404).json({ error: 'Firm not found' });
    }
    
    if (!username) {
        return res.status(400).json({ error: 'username required' });
    }
    
    try {
        db.assignCoreNodeToFirmByUsername(username, firmId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Remove a member from a firm (set firm to null)
app.delete('/api/firms/:firmId/members/:memberId', (req, res) => {
    const { firmId, memberId } = req.params;
    
    if (!FIRMS[firmId]) {
        return res.status(404).json({ error: 'Firm not found' });
    }
    
    try {
        db.removeCoreNodeFromFirm(parseInt(memberId));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get new follows for a specific firm (with optional member filter and pagination)
app.get('/api/new-follows/firm/:firmId', (req, res) => {
    const { firmId } = req.params;
    const { member, limit = 50, offset = 0 } = req.query;
    const firm = FIRMS[firmId];
    
    if (!firm) {
        return res.status(404).json({ error: 'Firm not found' });
    }
    
    try {
        let newFollows;
        let stats;
        
        if (member) {
            // Filter by specific member (still paginated)
            newFollows = db.getNewFollowsByMember(parseInt(member), parseInt(limit), parseInt(offset));
            const memberStats = db.getNewFollowsByMemberCount(parseInt(member));
            stats = memberStats || { total: 0, unreviewed: 0 };
        } else {
            // Get paginated for firm
            newFollows = db.getNewFollowsByFirm(firmId, parseInt(limit), parseInt(offset));
            const firmStats = db.getNewFollowsByFirmCount(firmId);
            stats = firmStats || { total: 0, unreviewed: 0 };
        }
        
        const members = db.getCoreNodesByFirm(firmId);
        res.json({ 
            firm: { id: firmId, ...firm, memberCount: members.length }, 
            newFollows,
            stats,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: newFollows.length === parseInt(limit)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get next unreviewed new follow for a firm
app.get('/api/new-follows/firm/:firmId/next', (req, res) => {
    const { firmId } = req.params;
    const firm = FIRMS[firmId];
    
    if (!firm) {
        return res.status(404).json({ error: 'Firm not found' });
    }
    
    try {
        const newFollow = db.getNextNewFollowByFirm(firmId);
        const stats = db.getNewFollowsByFirmCount(firmId) || { total: 0, unreviewed: 0 };
        
        if (!newFollow) {
            return res.json({ 
                newFollow: null, 
                message: `All ${firm.name} follows reviewed`,
                stats,
                firm: { id: firmId, ...firm }
            });
        }
        
        res.json({ newFollow, stats, firm: { id: firmId, ...firm } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get all unreviewed new follows
app.get('/api/new-follows', (req, res) => {
    try {
        const newFollows = db.getUnreviewedNewFollows();
        const stats = db.getNewFollowsStats();
        const byDate = db.getNewFollowsByDate();
        res.json({ newFollows, stats, byDate });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get next unreviewed new follow
app.get('/api/new-follows/next', (req, res) => {
    try {
        const newFollow = db.getNextUnreviewedNewFollow();
        const stats = db.getNewFollowsStats();
        
        if (!newFollow) {
            return res.json({ 
                newFollow: null, 
                message: 'All new follows reviewed',
                stats 
            });
        }
        
        res.json({ newFollow, stats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get new follows stats
app.get('/api/new-follows/stats', (req, res) => {
    try {
        const stats = db.getNewFollowsStats();
        const byDate = db.getNewFollowsByDate();
        const counts = db.getCategoryCounts();
        res.json({ stats, byDate, counts });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Categorize a new follow
app.post('/api/new-follows/:id/categorize', (req, res) => {
    const newFollowId = parseInt(req.params.id);
    const { category, userId } = req.body;
    
    if (!category) {
        return res.status(400).json({ error: 'category required' });
    }
    
    if (!['outbound', 'track', 'pass'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
    }
    
    try {
        // Mark the new follow as reviewed with category
        db.categorizeNewFollow(newFollowId, category);
        
        // Also add to main categorizations table if userId provided
        if (userId) {
            db.categorizeUser(userId, category, null);
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get next unreviewed new follow for a specific date
app.get('/api/new-follows/date/:date/next', (req, res) => {
    const { date } = req.params;
    
    try {
        const newFollow = db.getNextUnreviewedNewFollowByDate(date);
        const stats = db.getStatsByDate(date);
        const byDate = db.getNewFollowsByDate();
        
        if (!newFollow) {
            return res.json({ 
                newFollow: null, 
                message: 'All new follows for this date reviewed',
                stats,
                byDate
            });
        }
        
        res.json({ newFollow, stats, byDate });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get dates with new follows
app.get('/api/new-follows/dates', (req, res) => {
    try {
        const byDate = db.getNewFollowsByDate();
        res.json({ byDate });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get grouped new follows for a date (sorted by follow count)
app.get('/api/new-follows/date/:date/grouped', (req, res) => {
    const { date } = req.params;
    
    try {
        const grouped = db.getGroupedNewFollowsByDate(date);
        const stats = db.getGroupedNewFollowsStats(date);
        const byDate = db.getNewFollowsByDate();
        
        res.json({ grouped, stats, byDate });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Categorize all new follows for a user (grouped categorization)
app.post('/api/new-follows/user/:userId/categorize', (req, res) => {
    const userId = parseInt(req.params.userId);
    const { category } = req.body;
    
    if (!category) {
        return res.status(400).json({ error: 'category required' });
    }
    
    if (!['outbound', 'track', 'pass'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
    }
    
    try {
        // Mark all new_follows for this user as reviewed
        db.categorizeNewFollowsByUserId(userId, category);
        
        // Also add to main categorizations table
        db.categorizeUser(userId, category, null);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get core nodes list
app.get('/api/core-nodes', (req, res) => {
    try {
        const coreNodes = db.getAllCoreNodes();
        res.json({ coreNodes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get core nodes with stats (leaderboard)
app.get('/api/core-nodes/stats', (req, res) => {
    try {
        const coreNodes = db.getAllCoreNodesWithStats();
        res.json({ coreNodes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get single core node stats by username
app.get('/api/core-nodes/username/:username', (req, res) => {
    try {
        const coreNode = db.getCoreNodeByUsername(req.params.username);
        if (!coreNode) {
            return res.status(404).json({ error: 'Core node not found' });
        }
        res.json({ coreNode });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Stop tracking a core node
app.post('/api/core-nodes/:id/stop', (req, res) => {
    try {
        db.stopTrackingCoreNode(parseInt(req.params.id));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Resume tracking a core node
app.post('/api/core-nodes/:id/resume', (req, res) => {
    try {
        db.resumeTrackingCoreNode(parseInt(req.params.id));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// NETWORK ANALYSIS API (placeholder)
// ============================================

// API: Get network stats and analysis
app.get('/api/network/stats', (req, res) => {
    try {
        // Get basic counts from database
        const userCount = db.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        const followCount = db.db.prepare('SELECT COUNT(*) as count FROM follows').get().count;
        const coreNodeCount = db.db.prepare('SELECT COUNT(*) as count FROM core_nodes WHERE is_active = 1').get().count;
        
        // Get top users by follower count (placeholder for PageRank)
        const topUsers = db.db.prepare(`
            SELECT u.*, 
                   (SELECT COUNT(*) FROM follows f WHERE f.followed_user_id = u.id) as follow_count
            FROM users u
            ORDER BY u.followers_count DESC
            LIMIT 10
        `).all();
        
        // Placeholder clusters based on bio keywords
        const clusters = [
            { name: 'AI / ML', count: 0, keywords: ['AI', 'ML', 'machine learning'] },
            { name: 'Climate Tech', count: 0, keywords: ['climate', 'energy', 'nuclear'] },
            { name: 'Crypto / Web3', count: 0, keywords: ['crypto', 'web3', 'blockchain'] },
            { name: 'Defense Tech', count: 0, keywords: ['defense', 'aerospace', 'gov'] },
        ];
        
        res.json({
            nodeCount: userCount,
            edgeCount: followCount,
            coreNodeCount,
            topInfluencers: topUsers.map(u => ({
                ...u,
                pageRank: Math.random() * 0.01, // Placeholder
                cluster: clusters[Math.floor(Math.random() * clusters.length)].name
            })),
            clusters,
            trending: topUsers.slice(0, 5).map(u => ({
                ...u,
                momentum: Math.floor(Math.random() * 20) - 5 // Placeholder
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve index.html for all other routes (Express 5 syntax)
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
