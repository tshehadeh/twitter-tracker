// State
let currentSessionId = null;
let currentUser = null;
let currentNewFollow = null;
let currentView = 'welcome';
let currentDate = null; // For date-based new follows filtering
let groupedNewFollows = []; // List of grouped follows for current date
let currentGroupedIndex = 0; // Current position in grouped list

// DOM Elements
const views = {
    welcome: document.getElementById('welcome-view'),
    review: document.getElementById('review-view'),
    category: document.getElementById('category-view'),
    newFollows: document.getElementById('new-follows-view'),
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
    dateTabs: document.getElementById('date-tabs'),
    nfUnreviewedCount: document.getElementById('nf-unreviewed-count'),
    nfTotalCount: document.getElementById('nf-total-count'),
    nfBackBtn: document.getElementById('nf-back-btn'),
    nfCard: document.getElementById('nf-card'),
    nfEmptyCard: document.getElementById('nf-empty-card'),
    nfLoadingCard: document.getElementById('nf-loading-card'),
    nfCoreNode: document.getElementById('nf-core-node'),
    nfAvatar: document.getElementById('nf-avatar'),
    nfDisplayName: document.getElementById('nf-display-name'),
    nfUsername: document.getElementById('nf-username'),
    nfVerified: document.getElementById('nf-verified'),
    nfBio: document.getElementById('nf-bio'),
    nfFollowers: document.getElementById('nf-followers'),
    nfFollowing: document.getElementById('nf-following'),
    nfLink: document.getElementById('nf-link'),
    nfBtnOutbound: document.getElementById('nf-btn-outbound'),
    nfBtnTrack: document.getElementById('nf-btn-track'),
    nfBtnPass: document.getElementById('nf-btn-pass'),
    nfBackToHome: document.getElementById('nf-back-to-home'),
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
                    <a class="list-item-link" href="https://x.com/${user.username}" target="_blank">View</a>
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
function displayGroupedNewFollow(gf) {
    showNfLoading(false);
    
    const avatarUrl = gf.profile_image_url 
        ? gf.profile_image_url.replace('_normal', '_200x200')
        : '';
    
    // Format "followed by" text
    const usernames = gf.followed_by_usernames || [];
    let followedByText;
    if (usernames.length === 1) {
        followedByText = `@${usernames[0]} started following`;
    } else if (usernames.length === 2) {
        followedByText = `@${usernames[0]} and @${usernames[1]} started following`;
    } else if (usernames.length <= 4) {
        const lastUser = usernames[usernames.length - 1];
        const otherUsers = usernames.slice(0, -1).map(u => `@${u}`).join(', ');
        followedByText = `${otherUsers}, and @${lastUser} started following`;
    } else {
        const shown = usernames.slice(0, 3).map(u => `@${u}`).join(', ');
        followedByText = `${shown}, +${usernames.length - 3} more started following`;
    }
    
    // Update the header with follow count badge
    const badgeClass = gf.follow_count >= 3 ? 'follow-count-badge high' : 'follow-count-badge';
    elements.nfCoreNode.innerHTML = `<span class="${badgeClass}">${gf.follow_count}</span> ${followedByText}`;
    
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
    
    // Store current for categorization
    currentNewFollow = gf;
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

// New Follows event listeners
elements.newFollowsBtn.addEventListener('click', showNewFollowsView);
elements.nfBackBtn.addEventListener('click', () => showView('welcome'));
elements.nfBackToHome.addEventListener('click', () => showView('welcome'));
elements.nfBtnOutbound.addEventListener('click', () => categorizeNewFollow('outbound'));
elements.nfBtnTrack.addEventListener('click', () => categorizeNewFollow('track'));
elements.nfBtnPass.addEventListener('click', () => categorizeNewFollow('pass'));

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

// Initialize
async function init() {
    await loadSessions();
    await loadCounts();
    await loadNewFollowsStats();
}

init();
