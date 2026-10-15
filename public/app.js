// State
let currentSessionId = null;
let currentUser = null;
let currentNewFollow = null;
let currentView = 'welcome';
let currentDate = null; // For date-based new follows filtering
let currentFirm = null; // For firm-based new follows filtering
let currentMember = null; // For filtering by specific firm member
let firms = []; // List of available firms
let firmMembers = []; // List of members for current firm
let groupedNewFollows = []; // List of grouped follows for current date
let currentGroupedIndex = 0; // Current position in grouped list

// DOM Elements
const views = {
    welcome: document.getElementById('welcome-view'),
    review: document.getElementById('review-view'),
    category: document.getElementById('category-view'),
    newFollows: document.getElementById('new-follows-view'),
    network: document.getElementById('network-view'),
};

const elements = {
    urlInput: document.getElementById('url-input'),
    startBtn: document.getElementById('start-btn'),
    inputError: document.getElementById('input-error'),
    newSessionBtn: document.getElementById('new-session-btn'),
    sessionsList: document.getElementById('sessions-list'),
    
    reviewUsername: document.getElementById('review-username'),
    reviewedCount: document.getElementById('reviewed-count'),
    remainingCount: document.getElementById('remaining-count'),
    preFilteredText: document.getElementById('pre-filtered-text'),
    scrapeStatus: document.getElementById('scrape-status'),
    
    userCard: document.getElementById('user-card'),
    emptyCard: document.getElementById('empty-card'),
    loadingCard: document.getElementById('loading-card'),
    cardAvatar: document.getElementById('card-avatar'),
    cardDisplayName: document.getElementById('card-display-name'),
    cardUsername: document.getElementById('card-username'),
    cardVerified: document.getElementById('card-verified'),
    cardBio: document.getElementById('card-bio'),
    cardFollowers: document.getElementById('card-followers'),
    cardFollowing: document.getElementById('card-following'),
    cardLink: document.getElementById('card-link'),
    cardWebsite: document.getElementById('card-website'),
    
    btnOutbound: document.getElementById('btn-outbound'),
    btnTrack: document.getElementById('btn-track'),
    btnPass: document.getElementById('btn-pass'),
    backToSessions: document.getElementById('back-to-sessions'),
    
    categoryBtns: document.querySelectorAll('.category-btn'),
    countOutbound: document.getElementById('count-outbound'),
    countTrack: document.getElementById('count-track'),
    countPass: document.getElementById('count-pass'),
    
    backBtn: document.getElementById('back-btn'),
    categoryTitle: document.getElementById('category-title'),
    categoryTotal: document.getElementById('category-total'),
    categoryList: document.getElementById('category-list'),
    
    // New Follows elements
    newFollowsBtn: document.getElementById('new-follows-btn'),
    countNewFollows: document.getElementById('count-new-follows'),
    firmTabs: document.getElementById('firm-tabs'),
    dateTabs: document.getElementById('date-tabs'),
    nfUnreviewedCount: document.getElementById('nf-unreviewed-count'),
    nfTotalCount: document.getElementById('nf-total-count'),
    nfBackBtn: document.getElementById('nf-back-btn'),
    nfCard: document.getElementById('nf-card'),
    nfEmptyCard: document.getElementById('nf-empty-card'),
    nfLoadingCard: document.getElementById('nf-loading-card'),
    nfCoreNode: document.getElementById('nf-core-node'),
    nfCoreNodeStats: document.getElementById('nf-core-node-stats'),
    nfAvatar: document.getElementById('nf-avatar'),
    nfDisplayName: document.getElementById('nf-display-name'),
    nfUsername: document.getElementById('nf-username'),
    nfVerified: document.getElementById('nf-verified'),
    nfBio: document.getElementById('nf-bio'),
    nfFollowers: document.getElementById('nf-followers'),
    nfFollowing: document.getElementById('nf-following'),
    nfLink: document.getElementById('nf-link'),
    nfWebsite: document.getElementById('nf-website'),
    nfBtnOutbound: document.getElementById('nf-btn-outbound'),
    nfBtnTrack: document.getElementById('nf-btn-track'),
    nfBtnPass: document.getElementById('nf-btn-pass'),
    nfBackToHome: document.getElementById('nf-back-to-home'),
    
    // Firm sidebar elements
    firmSidebar: document.getElementById('firm-sidebar'),
    sidebarFirmName: document.getElementById('sidebar-firm-name'),
    sidebarShowAll: document.getElementById('sidebar-show-all'),
    firmMembersList: document.getElementById('firm-members-list'),
    addMemberInput: document.getElementById('add-member-input'),
    addMemberBtn: document.getElementById('add-member-btn'),
    
    // Tracked by panel elements
    trackedByPanel: document.getElementById('tracked-by-panel'),
    trackedByCount: document.getElementById('tracked-by-count'),
    trackedByList: document.getElementById('tracked-by-list'),
    
    // Theme toggle
    themeToggle: document.getElementById('theme-toggle'),
    
    // Network view elements
    networkBtn: document.getElementById('network-btn'),
    networkDate: document.getElementById('network-date'),
    networkNodeCount: document.getElementById('network-node-count'),
    networkEdgeCount: document.getElementById('network-edge-count'),
    networkSearch: document.getElementById('network-search'),
    networkClusterFilter: document.getElementById('network-cluster-filter'),
    networkTimeFilter: document.getElementById('network-time-filter'),
    influencersTbody: document.getElementById('influencers-tbody'),
    networkClusters: document.getElementById('network-clusters'),
    networkTrending: document.getElementById('network-trending'),
};

// View Management
function showView(viewName) {
    Object.keys(views).forEach(key => {
        views[key].classList.toggle('active', key === viewName);
    });
    currentView = viewName;
}

// API Functions
async function api(endpoint, options = {}) {
    const response = await fetch(`/api${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return response.json();
}

// Format numbers nicely
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

// Load Sessions
async function loadSessions() {
    const { sessions } = await api('/sessions');
    
    elements.sessionsList.innerHTML = sessions.map(session => `
        <div class="session-item ${session.id === currentSessionId ? 'active' : ''}" 
             data-session-id="${session.id}">
            @${session.seed_username}
        </div>
    `).join('') || '<div class="session-item" style="color: var(--text-muted)">No sessions yet</div>';
    
    // Add click handlers
    elements.sessionsList.querySelectorAll('.session-item[data-session-id]').forEach(item => {
        item.addEventListener('click', () => {
            const sessionId = parseInt(item.dataset.sessionId);
            loadSession(sessionId);
        });
    });
}

// Load Category Counts
async function loadCounts() {
    const counts = await api('/counts');
    elements.countOutbound.textContent = counts.outbound || 0;
    elements.countTrack.textContent = counts.track || 0;
    elements.countPass.textContent = counts.pass || 0;
}

// Start New Session
async function startSession(input) {
    elements.startBtn.disabled = true;
    elements.inputError.textContent = '';
    
    try {
        const result = await api('/session', {
            method: 'POST',
            body: { input },
        });
        
        if (result.error) {
            throw new Error(result.error);
        }
        
        currentSessionId = result.sessionId;
        await loadSessions();
        await loadSession(currentSessionId);
        
    } catch (error) {
        elements.inputError.textContent = error.message;
    } finally {
        elements.startBtn.disabled = false;
    }
}

// Load Session
async function loadSession(sessionId) {
    currentSessionId = sessionId;
    showView('review');
    showLoading(true);
    
    try {
        const { session, scrapeStatus, scrapeProgress, stats } = await api(`/session/${sessionId}`);
        
        elements.reviewUsername.textContent = `@${session.seed_username}`;
        updateStats(stats, scrapeStatus, scrapeProgress);
        
        // Mark session as active in sidebar
        elements.sessionsList.querySelectorAll('.session-item').forEach(item => {
            item.classList.toggle('active', parseInt(item.dataset.sessionId) === sessionId);
        });
        
        await loadNextUser();
        
        // Start polling for updates if still scraping
        if (scrapeStatus === 'running') {
            startStatusPolling();
        }
        
    } catch (error) {
        console.error('Error loading session:', error);
    }
}

// Update Stats Display
function updateStats(stats, status, progress) {
    const remaining = stats.remaining_count || 0;
    const reviewed = stats.reviewed_count || 0;
    const fetched = stats.fetched_count || 0;
    const preFiltered = fetched - remaining - reviewed;
    
    elements.remainingCount.textContent = remaining;
    elements.reviewedCount.textContent = reviewed;
    
    if (preFiltered > 0) {
        elements.preFilteredText.innerHTML = `<span class="progress-divider">|</span> <span class="pre-filtered">${preFiltered} already known</span>`;
    } else {
        elements.preFilteredText.textContent = '';
    }
    
    if (status === 'running') {
        elements.scrapeStatus.textContent = `Scraping... (${progress || 0} fetched)`;
        elements.scrapeStatus.className = 'scrape-status running';
    } else if (status === 'completed') {
        elements.scrapeStatus.textContent = 'Complete';
        elements.scrapeStatus.className = 'scrape-status completed';
    } else {
        elements.scrapeStatus.textContent = '';
        elements.scrapeStatus.className = 'scrape-status';
    }
}

// Status Polling
let statusPollInterval = null;

function startStatusPolling() {
    if (statusPollInterval) clearInterval(statusPollInterval);
    
    statusPollInterval = setInterval(async () => {
        if (!currentSessionId) {
            clearInterval(statusPollInterval);
            return;
        }
        
        const data = await api(`/session/${currentSessionId}/stats`);
        updateStats(data, data.scrapeStatus, data.scrapeProgress);
        loadCounts();
        
        if (data.scrapeStatus !== 'running') {
            clearInterval(statusPollInterval);
            statusPollInterval = null;
        }
    }, 3000);
}

// Show/Hide Loading
function showLoading(loading) {
    elements.loadingCard.style.display = loading ? 'block' : 'none';
    elements.userCard.style.display = loading ? 'none' : 'block';
    elements.emptyCard.style.display = 'none';
}

// Load Next User
async function loadNextUser() {
    showLoading(true);
    
    try {
        const { user, stats } = await api(`/session/${currentSessionId}/next`);
        
        if (!user) {
            elements.loadingCard.style.display = 'none';
            elements.userCard.style.display = 'none';
            elements.emptyCard.style.display = 'block';
            disableActionButtons(true);
            return;
        }
        
        currentUser = user;
        displayUser(user);
        updateStats(stats, null, null);
        disableActionButtons(false);
        
    } catch (error) {
        console.error('Error loading next user:', error);
    }
}

// Display User Card
function displayUser(user) {
    showLoading(false);
    
    const avatarUrl = user.profile_image_url 
        ? user.profile_image_url.replace('_normal', '_200x200')
        : '';
    
    elements.cardAvatar.src = avatarUrl;
    elements.cardAvatar.onerror = () => {
        elements.cardAvatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23333" width="100" height="100"/><text x="50" y="60" font-size="40" text-anchor="middle" fill="%23666">?</text></svg>';
    };
    
    elements.cardDisplayName.textContent = user.display_name || user.username;
    elements.cardUsername.textContent = `@${user.username}`;
    elements.cardVerified.style.display = user.verified ? 'flex' : 'none';
    elements.cardBio.textContent = user.bio || 'No bio';
    elements.cardFollowers.textContent = formatNumber(user.followers_count || 0);
    elements.cardFollowing.textContent = formatNumber(user.following_count || 0);
    elements.cardLink.href = `https://x.com/${user.username}`;
    
    // Show website link if available
    if (user.url) {
        try {
            elements.cardWebsite.href = user.url;
            elements.cardWebsite.textContent = new URL(user.url).hostname.replace('www.', '') + ' →';
            elements.cardWebsite.style.display = 'inline-block';
        } catch (e) {
            elements.cardWebsite.style.display = 'none';
        }
    } else {
        elements.cardWebsite.style.display = 'none';
    }
}

// Disable/Enable Action Buttons
function disableActionButtons(disabled) {
    elements.btnOutbound.disabled = disabled;
    elements.btnTrack.disabled = disabled;
    elements.btnPass.disabled = disabled;
}

// Categorize User
async function categorizeUser(category) {
    if (!currentUser || !currentSessionId) return;
    
    disableActionButtons(true);
    
    try {
        await api('/categorize', {
            method: 'POST',
            body: {
                userId: currentUser.id,
                category,
                sessionId: currentSessionId,
            },
        });
        
        await loadCounts();
        await loadNextUser();
        
    } catch (error) {
        console.error('Error categorizing user:', error);
        disableActionButtons(false);
    }
}

// Load Category List
async function loadCategory(category) {
    showView('category');
    
    const titles = {
        outbound: 'Outbound',
        track: 'Track',
        pass: 'Pass',
    };
    
    elements.categoryTitle.textContent = titles[category];
    elements.categoryList.innerHTML = '<div class="loading-card"><div class="spinner"></div></div>';
    
    try {
        const { users } = await api(`/categorized/${category}`);
        
        elements.categoryTotal.textContent = `${users.length} users`;
        
        if (users.length === 0) {
            elements.categoryList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No users in this category yet</p>';
            return;
        }
        
        elements.categoryList.innerHTML = users.map(user => {
            const avatarUrl = user.profile_image_url 
                ? user.profile_image_url.replace('_normal', '_200x200')
                : '';
            
            let websiteLink = '';
            if (user.url) {
                try {
                    const hostname = new URL(user.url).hostname.replace('www.', '');
                    websiteLink = `<a class="list-item-link website" href="${user.url}" target="_blank">${hostname}</a>`;
                } catch (e) {}
            }
            
            return `
                <div class="list-item">
                    <img class="list-item-avatar" src="${avatarUrl}" alt="" 
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23333%22 width=%22100%22 height=%22100%22/></svg>'">
                    <div class="list-item-content">
                        <div class="list-item-header">
                            <span class="list-item-name">${user.display_name || user.username}</span>
                            <span class="list-item-username">@${user.username}</span>
                        </div>
                        <p class="list-item-bio">${user.bio || 'No bio'}</p>
                        <div class="list-item-stats">
                            <span>${formatNumber(user.followers_count)} followers</span>
                            <span>${formatNumber(user.following_count)} following</span>
                        </div>
                    </div>
                    <div class="list-item-links">
                        <a class="list-item-link" href="https://x.com/${user.username}" target="_blank">View</a>
                        ${websiteLink}
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading category:', error);
        elements.categoryList.innerHTML = '<p style="text-align: center; color: var(--error);">Error loading users</p>';
    }
}

// Go Back
function goBack() {
    if (currentSessionId) {
        showView('review');
    } else {
        showView('welcome');
    }
}

// ============================================
// NEW FOLLOWS FUNCTIONS
// ============================================

// Load firms list
async function loadFirms() {
    try {
        const { firms: firmList } = await api('/firms');
        firms = firmList || [];
    } catch (error) {
        console.error('Error loading firms:', error);
        firms = [];
    }
}

// Render firm tabs
function renderFirmTabs() {
    const allTab = `<button class="firm-tab ${!currentFirm ? 'active' : ''}" data-firm="">All</button>`;
    const firmTabsHtml = firms
        .filter(f => f.memberCount > 0) // Only show firms with members
        .map(f => `
            <button class="firm-tab ${currentFirm === f.id ? 'active' : ''}" data-firm="${f.id}">
                ${f.name} <span class="firm-count">(${f.memberCount})</span>
            </button>
        `).join('');
    
    elements.firmTabs.innerHTML = allTab + firmTabsHtml;
    
    // Add click handlers
    elements.firmTabs.querySelectorAll('.firm-tab').forEach(tab => {
        tab.addEventListener('click', () => selectFirm(tab.dataset.firm || null));
    });
}

// Select a firm tab
async function selectFirm(firmId) {
    currentFirm = firmId;
    currentMember = null; // Reset member filter
    currentDate = null; // Reset date when changing firm
    renderFirmTabs();
    showNfLoading(true);
    
    if (firmId) {
        // Show sidebar and load members
        elements.firmSidebar.style.display = 'block';
        await loadFirmMembers(firmId);
        // Load firm-specific follows
        await loadFirmNewFollows(firmId);
    } else {
        // Hide sidebar
        elements.firmSidebar.style.display = 'none';
        firmMembers = [];
        // Load all follows (date-based)
        const { byDate } = await loadNewFollowsStats();
        if (byDate && byDate.length > 0) {
            const dateWithUnreviewed = byDate.find(d => d.unreviewed > 0);
            currentDate = dateWithUnreviewed ? dateWithUnreviewed.date : byDate[0].date;
        }
        renderDateTabs(byDate);
        await loadNextNewFollow();
    }
}

// Load firm members for sidebar
async function loadFirmMembers(firmId) {
    try {
        const { members, firm } = await api(`/firms/${firmId}/members`);
        firmMembers = members || [];
        elements.sidebarFirmName.textContent = firm?.name || firmId;
        renderFirmMembers();
    } catch (error) {
        console.error('Error loading firm members:', error);
        firmMembers = [];
    }
}

// Render firm members in sidebar
function renderFirmMembers() {
    // Sort by hit rate (track_count / total)
    const sorted = [...firmMembers].sort((a, b) => {
        const aTotal = (a.track_count || 0) + (a.pass_count || 0);
        const bTotal = (b.track_count || 0) + (b.pass_count || 0);
        const aRate = aTotal > 0 ? (a.track_count || 0) / aTotal : 0;
        const bRate = bTotal > 0 ? (b.track_count || 0) / bTotal : 0;
        return bRate - aRate; // Higher rate first
    });
    
    elements.firmMembersList.innerHTML = sorted.map(member => {
        const trackCount = member.track_count || 0;
        const passCount = member.pass_count || 0;
        const total = trackCount + passCount;
        const hitRate = total > 0 ? Math.round((trackCount / total) * 100) : 0;
        const hitRateClass = hitRate >= 50 ? '' : 'low';
        const isSelected = currentMember === member.id;
        
        return `
            <div class="member-item ${isSelected ? 'selected' : ''}" data-member-id="${member.id}">
                <div class="member-header">
                    <span class="member-username">@${member.username}</span>
                    <span class="member-stats">
                        ${total > 0 ? `<span class="hit-rate ${hitRateClass}">${hitRate}%</span> (${trackCount}/${total})` : 'No data'}
                    </span>
                    <button class="member-remove" data-member-id="${member.id}" data-username="${member.username}" title="Remove from firm">×</button>
                </div>
                <div class="member-bio">${member.bio || member.display_name || 'No bio'}</div>
                <div class="member-links">
                    <a class="member-link" href="https://x.com/${member.username}" target="_blank" onclick="event.stopPropagation()">Profile</a>
                    ${member.url ? `<a class="member-link" href="${member.url}" target="_blank" onclick="event.stopPropagation()">${(() => { try { return new URL(member.url).hostname.replace('www.', ''); } catch(e) { return 'Site'; } })()}</a>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // Update show all button state
    elements.sidebarShowAll.classList.toggle('active', !currentMember);
    
    // Add click handlers for selecting members
    elements.firmMembersList.querySelectorAll('.member-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't select if clicking remove button
            if (e.target.classList.contains('member-remove')) return;
            selectMember(parseInt(item.dataset.memberId));
        });
    });
    
    // Add click handlers for remove buttons
    elements.firmMembersList.querySelectorAll('.member-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeMemberFromFirm(parseInt(btn.dataset.memberId), btn.dataset.username);
        });
    });
}

// Select a specific member to filter by
async function selectMember(memberId) {
    if (currentMember === memberId) {
        // Toggle off - show all
        currentMember = null;
    } else {
        currentMember = memberId;
    }
    renderFirmMembers();
    showNfLoading(true);
    await loadFirmNewFollows(currentFirm);
}

// Show all firm members (clear filter)
async function showAllFirmMembers() {
    currentMember = null;
    renderFirmMembers();
    showNfLoading(true);
    await loadFirmNewFollows(currentFirm);
}

// Remove a member from the firm
async function removeMemberFromFirm(memberId, username) {
    if (!confirm(`Remove @${username} from this firm? They will no longer appear in this firm's feed.`)) {
        return;
    }
    
    try {
        await api(`/firms/${currentFirm}/members/${memberId}`, { method: 'DELETE' });
        
        // Remove from local list and re-render
        firmMembers = firmMembers.filter(m => m.id !== memberId);
        renderFirmMembers();
        
        // If we were filtering by this member, clear filter
        if (currentMember === memberId) {
            currentMember = null;
            showNfLoading(true);
            await loadFirmNewFollows(currentFirm);
        }
        
        // Reload firms to update counts
        await loadFirms();
        renderFirmTabs();
    } catch (error) {
        console.error('Error removing member:', error);
        alert('Failed to remove member');
    }
}

// Add a member to the firm by username
async function addMemberToFirm(username) {
    if (!username || !currentFirm) return;
    
    try {
        await api(`/firms/${currentFirm}/members`, {
            method: 'POST',
            body: { username }
        });
        
        // Reload members
        await loadFirmMembers(currentFirm);
        
        // Reload firms to update counts
        await loadFirms();
        renderFirmTabs();
    } catch (error) {
        console.error('Error adding member:', error);
        alert('Failed to add member. Make sure the username exists in your core nodes.');
    }
}

// Load new follows for a specific firm
async function loadFirmNewFollows(firmId) {
    try {
        // Build URL with optional member filter
        let url = `/new-follows/firm/${firmId}`;
        if (currentMember) {
            url += `?member=${currentMember}`;
        }
        const { newFollows, stats, firm } = await api(url);
        
        // Show member name if filtered, otherwise show firm info
        if (currentMember) {
            const member = firmMembers.find(m => m.id === currentMember);
            elements.dateTabs.innerHTML = `<span style="color: var(--text-muted); font-size: 12px;">${firm.name} → @${member?.username || 'member'}</span>`;
        } else {
            elements.dateTabs.innerHTML = `<span style="color: var(--text-muted); font-size: 12px;">${firm.name} • ${firm.memberCount || 0} accounts tracked</span>`;
        }
        
        // Update stats
        elements.nfUnreviewedCount.textContent = stats.unreviewed || 0;
        elements.nfTotalCount.textContent = stats.total || 0;
        
        // Convert to grouped format (group by followed user)
        const userMap = new Map();
        newFollows.forEach(nf => {
            const key = nf.followed_user_db_id;
            if (!userMap.has(key)) {
                userMap.set(key, {
                    user_id: nf.followed_user_db_id,
                    username: nf.followed_username,
                    display_name: nf.followed_display_name,
                    bio: nf.followed_bio,
                    url: nf.followed_url,
                    followers_count: nf.followed_followers,
                    following_count: nf.followed_following,
                    profile_image_url: nf.followed_avatar,
                    verified: nf.followed_verified,
                    existing_category: nf.existing_category,
                    followed_by_usernames: [],
                    follow_count: 0,
                    reviewed: nf.reviewed
                });
            }
            const user = userMap.get(key);
            // Dedupe - only add if not already in list
            if (!user.followed_by_usernames.includes(nf.core_node_username)) {
                user.followed_by_usernames.push(nf.core_node_username);
                user.follow_count++;
            }
        });
        
        // Convert to array and sort by follow count
        groupedNewFollows = Array.from(userMap.values())
            .filter(u => !u.reviewed || u.reviewed === 0)
            .sort((a, b) => b.follow_count - a.follow_count);
        currentGroupedIndex = 0;
        
        if (groupedNewFollows.length === 0) {
            elements.nfLoadingCard.style.display = 'none';
            elements.nfCard.style.display = 'none';
            elements.nfEmptyCard.style.display = 'block';
            disableNfActionButtons(true);
            return;
        }
        
        displayGroupedNewFollow(groupedNewFollows[0]);
        disableNfActionButtons(false);
        
    } catch (error) {
        console.error('Error loading firm new follows:', error);
    }
}

// Load new follows stats and update badge
async function loadNewFollowsStats() {
    try {
        const { stats, byDate } = await api('/new-follows/stats');
        const unreviewed = stats.unreviewed || 0;
        elements.countNewFollows.textContent = unreviewed;
        elements.countNewFollows.classList.toggle('highlight', unreviewed > 0);
        return { stats, byDate };
    } catch (error) {
        console.error('Error loading new follows stats:', error);
        return { stats: { total: 0, unreviewed: 0 }, byDate: [] };
    }
}

// Format date for display
function formatDateLabel(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.getTime() === today.getTime()) {
        return 'Today';
    } else if (date.getTime() === yesterday.getTime()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
}

// Render date tabs
function renderDateTabs(byDate) {
    if (!byDate || byDate.length === 0) {
        elements.dateTabs.innerHTML = '<span style="color: var(--text-secondary); font-size: 0.875rem;">No data yet</span>';
        return;
    }
    
    elements.dateTabs.innerHTML = byDate.map(d => {
        const isActive = d.date === currentDate;
        const label = formatDateLabel(d.date);
        return `
            <button class="date-tab ${isActive ? 'active' : ''}" data-date="${d.date}">
                ${label}<span class="tab-count">(${d.unreviewed}/${d.count})</span>
            </button>
        `;
    }).join('');
    
    // Add click handlers
    elements.dateTabs.querySelectorAll('.date-tab').forEach(tab => {
        tab.addEventListener('click', () => selectDate(tab.dataset.date));
    });
}

// Select a date tab
async function selectDate(date) {
    currentDate = date;
    showNfLoading(true);
    await loadNextNewFollow();
}

// Show new follows view
async function showNewFollowsView() {
    showView('newFollows');
    showNfLoading(true);
    
    // Load firms if not loaded
    if (firms.length === 0) {
        await loadFirms();
    }
    renderFirmTabs();
    
    // If a firm is selected, load firm follows, otherwise load date-based
    if (currentFirm) {
        await loadFirmNewFollows(currentFirm);
    } else {
        // Load stats and date tabs
        const { byDate } = await loadNewFollowsStats();
        
        // Auto-select first date with unreviewed items, or just first date
        if (byDate && byDate.length > 0) {
            const dateWithUnreviewed = byDate.find(d => d.unreviewed > 0);
            currentDate = dateWithUnreviewed ? dateWithUnreviewed.date : byDate[0].date;
        } else {
            currentDate = null;
        }
        
        renderDateTabs(byDate);
        await loadNextNewFollow();
    }
}

// Show/hide loading for new follows
function showNfLoading(loading) {
    elements.nfLoadingCard.style.display = loading ? 'block' : 'none';
    elements.nfCard.style.display = loading ? 'none' : 'block';
    elements.nfEmptyCard.style.display = 'none';
}

// Load grouped new follows for current date
async function loadGroupedNewFollows() {
    showNfLoading(true);
    
    try {
        if (!currentDate) {
            elements.nfLoadingCard.style.display = 'none';
            elements.nfCard.style.display = 'none';
            elements.nfEmptyCard.style.display = 'block';
            disableNfActionButtons(true);
            return;
        }
        
        const { grouped, stats, byDate } = await api(`/new-follows/date/${currentDate}/grouped`);
        
        // Store grouped follows
        groupedNewFollows = grouped || [];
        currentGroupedIndex = 0;
        
        // Update stats
        elements.nfUnreviewedCount.textContent = stats.unique_users || 0;
        elements.nfTotalCount.textContent = stats.total_follows || 0;
        
        // Update overall badge count
        if (byDate) {
            const totalUnreviewed = byDate.reduce((sum, d) => sum + (d.unreviewed || 0), 0);
            elements.countNewFollows.textContent = totalUnreviewed;
            renderDateTabs(byDate);
        }
        
        // Display first grouped follow
        if (groupedNewFollows.length === 0) {
            elements.nfLoadingCard.style.display = 'none';
            elements.nfCard.style.display = 'none';
            elements.nfEmptyCard.style.display = 'block';
            disableNfActionButtons(true);
            return;
        }
        
        displayGroupedNewFollow(groupedNewFollows[0]);
        disableNfActionButtons(false);
        
    } catch (error) {
        console.error('Error loading grouped new follows:', error);
    }
}

// Legacy function - now calls grouped version
async function loadNextNewFollow() {
    await loadGroupedNewFollows();
}

// Display grouped new follow card
async function displayGroupedNewFollow(gf) {
    showNfLoading(false);
    
    const avatarUrl = gf.profile_image_url 
        ? gf.profile_image_url.replace('_normal', '_200x200')
        : '';
    
    // Format "followed by" text - simplified since we have the panel now
    const usernames = gf.followed_by_usernames || [];
    const followedByText = usernames.length === 1 
        ? `@${usernames[0]} started following`
        : `${usernames.length} people started following`;
    
    // Update the header with follow count badge
    const badgeClass = gf.follow_count >= 3 ? 'follow-count-badge high' : 'follow-count-badge';
    elements.nfCoreNode.innerHTML = `<span class="${badgeClass}">${gf.follow_count}</span> ${followedByText}`;
    
    // Show existing category badge if already categorized
    if (gf.existing_category) {
        elements.nfCoreNode.innerHTML += ` <span class="category-badge ${gf.existing_category}">(${gf.existing_category})</span>`;
    }
    
    // Populate the tracked-by panel
    await displayTrackedByPanel(usernames);
    
    elements.nfAvatar.src = avatarUrl;
    elements.nfAvatar.onerror = () => {
        elements.nfAvatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23333" width="100" height="100"/><text x="50" y="60" font-size="40" text-anchor="middle" fill="%23666">?</text></svg>';
    };
    
    elements.nfDisplayName.textContent = gf.display_name || gf.username;
    elements.nfUsername.textContent = `@${gf.username}`;
    elements.nfVerified.style.display = gf.verified ? 'flex' : 'none';
    elements.nfBio.textContent = gf.bio || 'No bio';
    elements.nfFollowers.textContent = formatNumber(gf.followers_count || 0);
    elements.nfFollowing.textContent = formatNumber(gf.following_count || 0);
    elements.nfLink.href = `https://x.com/${gf.username}`;
    
    // Show website link if available
    if (gf.url) {
        try {
            elements.nfWebsite.href = gf.url;
            elements.nfWebsite.textContent = new URL(gf.url).hostname.replace('www.', '') + ' →';
            elements.nfWebsite.style.display = 'inline-block';
        } catch (e) {
            elements.nfWebsite.style.display = 'none';
        }
    } else {
        elements.nfWebsite.style.display = 'none';
    }
    
    // Store current for categorization
    currentNewFollow = gf;
}

// Display tracked-by panel with core nodes who followed this person
async function displayTrackedByPanel(usernames) {
    if (!usernames || usernames.length === 0) {
        elements.trackedByCount.textContent = '0';
        elements.trackedByList.innerHTML = '<p style="padding: 16px; color: var(--text-muted); font-size: 12px;">No trackers</p>';
        return;
    }
    
    elements.trackedByCount.textContent = usernames.length;
    elements.trackedByList.innerHTML = '<div style="padding: 16px; text-align: center;"><div class="spinner"></div></div>';
    
    // Fetch stats for each core node
    const trackers = [];
    for (const username of usernames) {
        try {
            const { coreNode } = await api(`/core-nodes/username/${username}`);
            if (coreNode) {
                trackers.push(coreNode);
            }
        } catch (error) {
            // If API fails, just show username without stats
            trackers.push({ username, track_count: 0, pass_count: 0 });
        }
    }
    
    // Sort by track rate (higher is better)
    trackers.sort((a, b) => {
        const aTotal = (a.track_count || 0) + (a.pass_count || 0);
        const bTotal = (b.track_count || 0) + (b.pass_count || 0);
        const aRate = aTotal > 0 ? (a.track_count || 0) / aTotal : 0;
        const bRate = bTotal > 0 ? (b.track_count || 0) / bTotal : 0;
        return bRate - aRate;
    });
    
    // Render trackers
    elements.trackedByList.innerHTML = trackers.map(tracker => {
        const trackCount = tracker.track_count || 0;
        const passCount = tracker.pass_count || 0;
        const total = trackCount + passCount;
        const trackRate = total > 0 ? Math.round((trackCount / total) * 100) : 0;
        const rateClass = total > 0 ? (trackRate >= 50 ? 'good' : 'bad') : '';
        
        return `
            <div class="tracker-item">
                <div class="tracker-header">
                    <span class="tracker-username">
                        <a href="https://x.com/${tracker.username}" target="_blank">@${tracker.username}</a>
                    </span>
                    ${total > 0 ? `<span class="tracker-rate ${rateClass}">${trackRate}%</span>` : ''}
                </div>
                <div class="tracker-bio">${tracker.bio || tracker.display_name || 'No bio'}</div>
                <div class="tracker-links">
                    <a class="tracker-link" href="https://x.com/${tracker.username}" target="_blank">Profile</a>
                    ${tracker.url ? `<a class="tracker-link" href="${tracker.url}" target="_blank">${(() => { try { return new URL(tracker.url).hostname.replace('www.', ''); } catch(e) { return 'Website'; } })()}</a>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Display core node stats badges
async function displayCoreNodeStats(usernames) {
    if (!usernames || usernames.length === 0) {
        elements.nfCoreNodeStats.innerHTML = '';
        return;
    }
    
    // Fetch stats for each core node (limit to first 5 to avoid too many requests)
    const statsToShow = usernames.slice(0, 5);
    const statsHtml = [];
    
    for (const username of statsToShow) {
        try {
            const { coreNode } = await api(`/core-nodes/username/${username}`);
            if (coreNode && coreNode.total_categorized > 0) {
                const passRateClass = coreNode.pass_rate > 70 ? 'bad' : coreNode.pass_rate < 30 ? 'good' : '';
                statsHtml.push(`
                    <span class="core-node-stat" data-core-node-id="${coreNode.id}">
                        <span class="username">@${coreNode.username}</span>
                        <span class="rate ${passRateClass}">${coreNode.track_rate}% track / ${coreNode.pass_rate}% pass</span>
                        <button class="stop-btn" title="Stop tracking @${coreNode.username}" onclick="stopTrackingCoreNode(${coreNode.id}, '${coreNode.username}')">×</button>
                    </span>
                `);
            }
        } catch (e) {
            // Core node not found, skip
        }
    }
    
    elements.nfCoreNodeStats.innerHTML = statsHtml.join('');
}

// Stop tracking a core node
async function stopTrackingCoreNode(id, username) {
    if (!confirm(`Stop tracking @${username}? They will be excluded from future scrapes.`)) {
        return;
    }
    
    try {
        await api(`/core-nodes/${id}/stop`, { method: 'POST' });
        // Remove from display
        const badge = document.querySelector(`.core-node-stat[data-core-node-id="${id}"]`);
        if (badge) {
            badge.style.opacity = '0.5';
            badge.innerHTML = `<span class="username">@${username}</span> <span class="rate">(stopped)</span>`;
        }
    } catch (error) {
        console.error('Error stopping core node:', error);
    }
}

// Legacy display function
function displayNewFollow(nf) {
    displayGroupedNewFollow({
        profile_image_url: nf.followed_avatar,
        followed_by_usernames: [nf.core_node_username],
        follow_count: 1,
        display_name: nf.followed_display_name,
        username: nf.followed_username,
        verified: nf.followed_verified,
        bio: nf.followed_bio,
        url: nf.followed_url,
        followers_count: nf.followed_followers,
        following_count: nf.followed_following,
        user_id: nf.followed_user_db_id
    });
}

// Disable/enable new follows action buttons
function disableNfActionButtons(disabled) {
    elements.nfBtnOutbound.disabled = disabled;
    elements.nfBtnTrack.disabled = disabled;
    elements.nfBtnPass.disabled = disabled;
}

// Categorize new follow (grouped - marks all new_follows for this user)
async function categorizeNewFollow(category) {
    if (!currentNewFollow) return;
    
    disableNfActionButtons(true);
    
    try {
        // Use the grouped categorization endpoint
        await api(`/new-follows/user/${currentNewFollow.user_id}/categorize`, {
            method: 'POST',
            body: { category },
        });
        
        await loadCounts();
        
        // Move to next in the grouped list
        currentGroupedIndex++;
        if (currentGroupedIndex < groupedNewFollows.length) {
            displayGroupedNewFollow(groupedNewFollows[currentGroupedIndex]);
            disableNfActionButtons(false);
        } else {
            // Reload to get fresh data
            await loadGroupedNewFollows();
        }
        
    } catch (error) {
        console.error('Error categorizing new follow:', error);
        disableNfActionButtons(false);
    }
}

// Event Listeners
elements.startBtn.addEventListener('click', () => {
    const input = elements.urlInput.value.trim();
    if (input) {
        startSession(input);
    }
});

elements.urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const input = elements.urlInput.value.trim();
        if (input) {
            startSession(input);
        }
    }
});

elements.newSessionBtn.addEventListener('click', () => {
    currentSessionId = null;
    elements.urlInput.value = '';
    elements.inputError.textContent = '';
    showView('welcome');
    loadSessions();
});

elements.btnOutbound.addEventListener('click', () => categorizeUser('outbound'));
elements.btnTrack.addEventListener('click', () => categorizeUser('track'));
elements.btnPass.addEventListener('click', () => categorizeUser('pass'));

elements.backToSessions.addEventListener('click', () => {
    showView('welcome');
});

elements.categoryBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const category = btn.dataset.category;
        loadCategory(category);
    });
});

elements.backBtn.addEventListener('click', goBack);

// Network view event listener
elements.networkBtn.addEventListener('click', showNetworkView);

// New Follows event listeners
elements.newFollowsBtn.addEventListener('click', showNewFollowsView);
elements.nfBackBtn.addEventListener('click', () => showView('welcome'));
elements.nfBackToHome.addEventListener('click', () => showView('welcome'));
elements.nfBtnOutbound.addEventListener('click', () => categorizeNewFollow('outbound'));
elements.nfBtnTrack.addEventListener('click', () => categorizeNewFollow('track'));
elements.nfBtnPass.addEventListener('click', () => categorizeNewFollow('pass'));

// Firm sidebar event listeners
elements.sidebarShowAll.addEventListener('click', showAllFirmMembers);
elements.addMemberBtn.addEventListener('click', () => {
    const username = elements.addMemberInput.value.trim().replace('@', '');
    if (username) {
        addMemberToFirm(username);
        elements.addMemberInput.value = '';
    }
});
elements.addMemberInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const username = elements.addMemberInput.value.trim().replace('@', '');
        if (username) {
            addMemberToFirm(username);
            elements.addMemberInput.value = '';
        }
    }
});

// Theme toggle
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    elements.themeToggle.textContent = newTheme === 'light' ? '◑' : '◐';
}

function loadSavedTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (elements.themeToggle) {
        elements.themeToggle.textContent = savedTheme === 'light' ? '◑' : '◐';
    }
}

elements.themeToggle.addEventListener('click', toggleTheme);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Handle review view shortcuts
    if (currentView === 'review' && currentUser) {
        switch (e.key) {
            case '1':
            case 'o':
                categorizeUser('outbound');
                break;
            case '2':
            case 't':
                categorizeUser('track');
                break;
            case '3':
            case 'p':
                categorizeUser('pass');
                break;
        }
    }
    
    // Handle new follows view shortcuts
    if (currentView === 'newFollows' && currentNewFollow) {
        switch (e.key) {
            case '1':
            case 'o':
                categorizeNewFollow('outbound');
                break;
            case '2':
            case 't':
                categorizeNewFollow('track');
                break;
            case '3':
            case 'p':
                categorizeNewFollow('pass');
                break;
        }
    }
});

// ============================================
// NETWORK VIEW FUNCTIONS
// ============================================

async function showNetworkView() {
    showView('network');
    
    // Set current date
    elements.networkDate.textContent = new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    
    // Load network data
    await loadNetworkData();
}

async function loadNetworkData() {
    try {
        // Fetch network stats from API
        const data = await api('/network/stats');
        
        elements.networkNodeCount.textContent = data.nodeCount || 0;
        elements.networkEdgeCount.textContent = data.edgeCount || 0;
        
        // Populate top influencers
        if (data.topInfluencers && data.topInfluencers.length > 0) {
            elements.influencersTbody.innerHTML = data.topInfluencers.map((user, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td><a href="https://x.com/${user.username}" target="_blank">@${user.username}</a></td>
                    <td>${user.pageRank?.toFixed(4) || '—'}</td>
                    <td>${user.cluster || '—'}</td>
                    <td>${formatNumber(user.followers_count || 0)}</td>
                </tr>
            `).join('');
        }
        
        // Populate clusters
        if (data.clusters && data.clusters.length > 0) {
            elements.networkClusters.innerHTML = data.clusters.map(cluster => `
                <div class="cluster-card">
                    <h3>${cluster.name}</h3>
                    <div class="cluster-count">${cluster.count}</div>
                    <div class="cluster-keywords">${cluster.keywords?.join(', ') || ''}</div>
                </div>
            `).join('');
        }
        
        // Populate trending
        if (data.trending && data.trending.length > 0) {
            elements.networkTrending.innerHTML = data.trending.map((user, i) => `
                <div class="trending-item">
                    <span class="trending-rank">${i + 1}</span>
                    <div class="trending-info">
                        <div class="trending-name">@${user.username}</div>
                        <div class="trending-bio">${user.bio?.substring(0, 60) || 'No bio'}...</div>
                    </div>
                    <span class="trending-momentum ${user.momentum < 0 ? 'negative' : ''}">
                        ${user.momentum > 0 ? '+' : ''}${user.momentum || 0}%
                    </span>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.log('Network API not yet implemented');
        // Show placeholder data for now
        elements.networkNodeCount.textContent = '—';
        elements.networkEdgeCount.textContent = '—';
        elements.influencersTbody.innerHTML = '<tr><td colspan="5" class="loading">Network analysis coming soon...</td></tr>';
        elements.networkClusters.innerHTML = '<p class="loading">Community detection coming soon...</p>';
        elements.networkTrending.innerHTML = '<p class="loading">Momentum tracking coming soon...</p>';
    }
}

// Initialize
async function init() {
    loadSavedTheme();
    await loadSessions();
    await loadCounts();
    await loadNewFollowsStats();
}

init();
