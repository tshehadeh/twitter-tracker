#!/usr/bin/env python3
"""
Network Analysis for Attention Is All You Need
Runs PageRank, Louvain clustering, and validation analysis on the follow graph.
"""

import sqlite3
import json
from collections import defaultdict
from datetime import datetime, timedelta
import math

DB_PATH = 'data/tracker.db'

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# =============================================================================
# PAGERANK IMPLEMENTATION
# =============================================================================

def compute_pagerank(edges, damping=0.85, iterations=100, tolerance=1e-6):
    """
    Compute PageRank on a directed graph.
    
    The PageRank of node i is defined as:
        PR(i) = (1-d)/N + d * Σ(PR(j)/L(j)) for all j linking to i
    
    Where:
        d = damping factor (probability of following a link vs random jump)
        N = total number of nodes
        L(j) = number of outbound links from j
    """
    # Build adjacency structures
    nodes = set()
    outbound = defaultdict(set)  # who does each node follow
    inbound = defaultdict(set)   # who follows each node
    
    for source, target in edges:
        nodes.add(source)
        nodes.add(target)
        outbound[source].add(target)
        inbound[target].add(source)
    
    N = len(nodes)
    if N == 0:
        return {}
    
    # Initialize PageRank uniformly
    pr = {node: 1.0 / N for node in nodes}
    
    # Iterative computation
    for iteration in range(iterations):
        new_pr = {}
        diff = 0
        
        for node in nodes:
            # Sum contributions from all nodes pointing to this one
            rank_sum = 0
            for source in inbound[node]:
                if len(outbound[source]) > 0:
                    rank_sum += pr[source] / len(outbound[source])
            
            new_pr[node] = (1 - damping) / N + damping * rank_sum
            diff += abs(new_pr[node] - pr[node])
        
        pr = new_pr
        
        if diff < tolerance:
            print(f"  PageRank converged after {iteration + 1} iterations")
            break
    
    return pr

# =============================================================================
# LOUVAIN COMMUNITY DETECTION
# =============================================================================

def compute_modularity(communities, edges, node_degrees):
    """
    Compute modularity Q of a partition.
    
    Q = (1/2m) * Σ[A_ij - (k_i * k_j)/(2m)] * δ(c_i, c_j)
    
    Where:
        m = total number of edges
        A_ij = 1 if edge exists between i and j
        k_i = degree of node i
        δ(c_i, c_j) = 1 if i and j are in the same community
    """
    m = len(edges)
    if m == 0:
        return 0
    
    # Build edge set for fast lookup
    edge_set = set()
    for a, b in edges:
        edge_set.add((a, b))
        edge_set.add((b, a))  # Treat as undirected for modularity
    
    # Map nodes to communities
    node_to_community = {}
    for comm_id, members in communities.items():
        for node in members:
            node_to_community[node] = comm_id
    
    Q = 0
    nodes = list(node_degrees.keys())
    
    for i in nodes:
        for j in nodes:
            if node_to_community.get(i) == node_to_community.get(j):
                A_ij = 1 if (i, j) in edge_set else 0
                expected = (node_degrees.get(i, 0) * node_degrees.get(j, 0)) / (2 * m)
                Q += A_ij - expected
    
    return Q / (2 * m)

def louvain_clustering(edges, resolution=1.0):
    """
    Simplified Louvain algorithm for community detection.
    Maximizes modularity through greedy local optimization.
    """
    # Build undirected graph
    neighbors = defaultdict(set)
    for a, b in edges:
        neighbors[a].add(b)
        neighbors[b].add(a)
    
    nodes = list(neighbors.keys())
    
    # Compute degrees
    degrees = {node: len(neighbors[node]) for node in nodes}
    m = len(edges)
    
    # Initialize: each node in its own community
    node_to_comm = {node: i for i, node in enumerate(nodes)}
    
    # Greedy optimization
    improved = True
    iterations = 0
    max_iterations = 50
    
    while improved and iterations < max_iterations:
        improved = False
        iterations += 1
        
        for node in nodes:
            current_comm = node_to_comm[node]
            
            # Find neighboring communities
            neighbor_comms = defaultdict(float)
            for neighbor in neighbors[node]:
                comm = node_to_comm[neighbor]
                neighbor_comms[comm] += 1
            
            # Calculate modularity gain for moving to each community
            best_comm = current_comm
            best_gain = 0
            
            for comm, links in neighbor_comms.items():
                if comm != current_comm:
                    # Simplified modularity gain calculation
                    gain = links - resolution * degrees[node] * sum(
                        degrees[n] for n in nodes if node_to_comm[n] == comm
                    ) / (2 * m)
                    
                    if gain > best_gain:
                        best_gain = gain
                        best_comm = comm
            
            if best_comm != current_comm:
                node_to_comm[node] = best_comm
                improved = True
    
    # Collect communities
    communities = defaultdict(set)
    for node, comm in node_to_comm.items():
        communities[comm].add(node)
    
    # Remove empty communities and renumber
    final_communities = {}
    for i, (comm_id, members) in enumerate(sorted(communities.items(), key=lambda x: -len(x[1]))):
        if len(members) > 0:
            final_communities[i] = members
    
    print(f"  Louvain converged after {iterations} iterations, found {len(final_communities)} communities")
    
    return final_communities, node_to_comm

# =============================================================================
# DATA EXTRACTION
# =============================================================================

def extract_follow_graph(db):
    """Extract the follow graph from core_nodes -> users they follow."""
    cursor = db.cursor()
    
    # Get all follows: core_node follows user
    # The 'follows' table stores: core_node_id -> followed_user_id
    cursor.execute("""
        SELECT cn.twitter_id as source, u.twitter_id as target
        FROM follows f
        JOIN core_nodes cn ON f.core_node_id = cn.id
        JOIN users u ON f.followed_user_id = u.id
    """)
    
    edges = [(row['source'], row['target']) for row in cursor.fetchall()]
    return edges

def get_user_info(db):
    """Get user metadata for analysis."""
    cursor = db.cursor()
    
    cursor.execute("""
        SELECT twitter_id, username, display_name, bio, followers_count, following_count
        FROM users
    """)
    
    users = {row['twitter_id']: dict(row) for row in cursor.fetchall()}
    return users

def get_core_nodes(db):
    """Get core node metadata."""
    cursor = db.cursor()
    
    cursor.execute("""
        SELECT twitter_id, username, firm, followers_count
        FROM core_nodes
    """)
    
    return {row['twitter_id']: dict(row) for row in cursor.fetchall()}

def get_new_follows_by_date(db):
    """Get new follows with detection dates for momentum analysis."""
    cursor = db.cursor()
    
    cursor.execute("""
        SELECT 
            u.twitter_id,
            u.username,
            nf.detected_at,
            cn.username as core_node_username
        FROM new_follows nf
        JOIN users u ON nf.followed_user_id = u.id
        JOIN core_nodes cn ON nf.core_node_id = cn.id
        ORDER BY nf.detected_at
    """)
    
    return cursor.fetchall()

# =============================================================================
# ANALYSIS
# =============================================================================

def analyze_pagerank_vs_followers(pagerank, users, core_nodes):
    """Compare PageRank rankings to raw follower counts."""
    
    # Get follower counts for all users in PageRank
    pr_with_followers = []
    for twitter_id, pr_score in pagerank.items():
        if twitter_id in users:
            pr_with_followers.append({
                'twitter_id': twitter_id,
                'username': users[twitter_id]['username'],
                'pagerank': pr_score,
                'followers': users[twitter_id].get('followers_count', 0) or 0,
                'bio': users[twitter_id].get('bio', '')[:100]
            })
        elif twitter_id in core_nodes:
            pr_with_followers.append({
                'twitter_id': twitter_id,
                'username': core_nodes[twitter_id]['username'],
                'pagerank': pr_score,
                'followers': core_nodes[twitter_id].get('followers_count', 0) or 0,
                'bio': '[Core Node]'
            })
    
    # Sort by PageRank
    by_pagerank = sorted(pr_with_followers, key=lambda x: -x['pagerank'])
    
    # Sort by followers
    by_followers = sorted(pr_with_followers, key=lambda x: -x['followers'])
    
    # Create rank mappings
    pr_rank = {item['twitter_id']: i for i, item in enumerate(by_pagerank)}
    follower_rank = {item['twitter_id']: i for i, item in enumerate(by_followers)}
    
    # Find divergences
    divergences = []
    for item in pr_with_followers:
        tid = item['twitter_id']
        pr_r = pr_rank.get(tid, 999999)
        f_r = follower_rank.get(tid, 999999)
        divergences.append({
            **item,
            'pr_rank': pr_r,
            'follower_rank': f_r,
            'divergence': f_r - pr_r  # Positive = PR ranks higher than followers would suggest
        })
    
    return by_pagerank, by_followers, divergences

def count_vc_follows(user_id, edges, core_node_ids):
    """Count how many core nodes (VCs) follow a user."""
    count = 0
    for source, target in edges:
        if target == user_id and source in core_node_ids:
            count += 1
    return count

def compute_spearman(rank1, rank2, ids):
    """Compute Spearman correlation between two rankings."""
    n = len(ids)
    if n == 0:
        return 0
    
    d_squared_sum = sum((rank1.get(i, n) - rank2.get(i, n)) ** 2 for i in ids)
    
    return 1 - (6 * d_squared_sum) / (n * (n**2 - 1))

# =============================================================================
# MAIN
# =============================================================================

def main():
    print("=" * 70)
    print("NETWORK ANALYSIS: ATTENTION IS ALL YOU NEED")
    print("=" * 70)
    print()
    
    db = get_db()
    
    # Extract data
    print("1. EXTRACTING DATA")
    print("-" * 40)
    
    edges = extract_follow_graph(db)
    print(f"   Edges (follow relationships): {len(edges):,}")
    
    users = get_user_info(db)
    print(f"   Users: {len(users):,}")
    
    core_nodes = get_core_nodes(db)
    print(f"   Core nodes: {len(core_nodes):,}")
    core_node_ids = set(core_nodes.keys())
    
    if len(edges) == 0:
        print("\n   ERROR: No edges found in follows table.")
        print("   Checking new_follows table instead...")
        
        cursor = db.cursor()
        cursor.execute("""
            SELECT cn.twitter_id as source, u.twitter_id as target
            FROM new_follows nf
            JOIN core_nodes cn ON nf.core_node_id = cn.id
            JOIN users u ON nf.followed_user_id = u.id
        """)
        edges = [(row['source'], row['target']) for row in cursor.fetchall()]
        print(f"   Edges from new_follows: {len(edges):,}")
    
    if len(edges) == 0:
        print("\n   No edge data available for analysis.")
        return
    
    print()
    
    # PageRank
    print("2. COMPUTING PAGERANK")
    print("-" * 40)
    print(f"   Damping factor: 0.85")
    print(f"   Max iterations: 100")
    
    pagerank = compute_pagerank(edges, damping=0.85)
    print(f"   Nodes with PageRank scores: {len(pagerank):,}")
    print()
    
    # Community Detection
    print("3. COMMUNITY DETECTION (LOUVAIN)")
    print("-" * 40)
    
    communities, node_to_comm = louvain_clustering(edges)
    
    # Compute degrees for modularity
    degrees = defaultdict(int)
    for a, b in edges:
        degrees[a] += 1
        degrees[b] += 1
    
    modularity = compute_modularity(communities, edges, degrees)
    print(f"   Modularity score: {modularity:.4f}")
    print(f"   Communities found: {len(communities)}")
    
    # Show community sizes
    print("\n   Top 10 communities by size:")
    for i, (comm_id, members) in enumerate(sorted(communities.items(), key=lambda x: -len(x[1]))[:10]):
        print(f"      Cluster {i}: {len(members):,} members")
    print()
    
    # PageRank Analysis
    print("4. PAGERANK VS FOLLOWER COUNT ANALYSIS")
    print("-" * 40)
    
    by_pagerank, by_followers, divergences = analyze_pagerank_vs_followers(pagerank, users, core_nodes)
    
    print("\n   TOP 50 BY PAGERANK:")
    print("   " + "-" * 66)
    print(f"   {'Rank':<6} {'Username':<20} {'PageRank':<12} {'Followers':<12} {'Divergence':<10}")
    print("   " + "-" * 66)
    
    for i, item in enumerate(by_pagerank[:50]):
        div = next((d['divergence'] for d in divergences if d['twitter_id'] == item['twitter_id']), 0)
        div_str = f"+{div}" if div > 0 else str(div)
        print(f"   {i+1:<6} @{item['username']:<19} {item['pagerank']:.8f}   {item['followers']:<12,} {div_str:<10}")
    
    print()
    
    # Find biggest divergences
    print("   LARGEST DIVERGENCES (PageRank >> Followers):")
    print("   " + "-" * 66)
    sorted_div = sorted(divergences, key=lambda x: -x['divergence'])
    for item in sorted_div[:10]:
        print(f"   @{item['username']:<20} PR Rank: {item['pr_rank']:<6} Follower Rank: {item['follower_rank']:<6} Δ: +{item['divergence']}")
        print(f"      Followers: {item['followers']:,} | Bio: {item['bio'][:60]}...")
        print()
    
    # Baseline comparison
    print("5. BASELINE COMPARISON")
    print("-" * 40)
    
    # Compute VC follow counts
    print("   Computing VC follow counts...")
    all_node_ids = list(pagerank.keys())
    vc_follow_counts = {}
    for node_id in all_node_ids:
        vc_follow_counts[node_id] = count_vc_follows(node_id, edges, core_node_ids)
    
    # Create rankings
    pr_rank = {item['twitter_id']: i for i, item in enumerate(sorted(divergences, key=lambda x: -x['pagerank']))}
    follower_rank = {item['twitter_id']: i for i, item in enumerate(sorted(divergences, key=lambda x: -x['followers']))}
    vc_rank = {k: i for i, (k, v) in enumerate(sorted(vc_follow_counts.items(), key=lambda x: -x[1]))}
    
    common_ids = set(pr_rank.keys()) & set(follower_rank.keys()) & set(vc_rank.keys())
    
    spearman_pr_followers = compute_spearman(pr_rank, follower_rank, common_ids)
    spearman_pr_vc = compute_spearman(pr_rank, vc_rank, common_ids)
    spearman_followers_vc = compute_spearman(follower_rank, vc_rank, common_ids)
    
    print(f"\n   Spearman Correlations:")
    print(f"      PageRank vs Follower Count:    {spearman_pr_followers:.4f}")
    print(f"      PageRank vs VC Follow Count:   {spearman_pr_vc:.4f}")
    print(f"      Follower Count vs VC Follows:  {spearman_followers_vc:.4f}")
    print()
    
    # Label communities with sample members
    print("6. COMMUNITY CHARACTERIZATION")
    print("-" * 40)
    
    for comm_id, members in sorted(communities.items(), key=lambda x: -len(x[1]))[:5]:
        print(f"\n   CLUSTER {comm_id} ({len(members):,} members)")
        
        # Get top members by PageRank
        cluster_pr = [(m, pagerank.get(m, 0)) for m in members]
        cluster_pr.sort(key=lambda x: -x[1])
        
        print("   Top members by PageRank:")
        for tid, pr in cluster_pr[:5]:
            username = users.get(tid, {}).get('username') or core_nodes.get(tid, {}).get('username', '?')
            bio = users.get(tid, {}).get('bio', '')[:50]
            print(f"      @{username}: {bio}...")
    
    print()
    
    # Summary statistics
    print("7. SUMMARY")
    print("-" * 40)
    print(f"   Total nodes analyzed: {len(pagerank):,}")
    print(f"   Total edges: {len(edges):,}")
    print(f"   Core nodes (tracked VCs): {len(core_nodes):,}")
    print(f"   Communities detected: {len(communities)}")
    print(f"   Modularity: {modularity:.4f}")
    print(f"   PageRank-Follower correlation: {spearman_pr_followers:.4f}")
    print()
    
    # Export for whitepaper
    print("8. EXPORTING RESULTS")
    print("-" * 40)
    
    results = {
        'stats': {
            'total_nodes': len(pagerank),
            'total_edges': len(edges),
            'core_nodes': len(core_nodes),
            'communities': len(communities),
            'modularity': modularity,
            'spearman_pr_followers': spearman_pr_followers,
            'spearman_pr_vc': spearman_pr_vc
        },
        'top_50_pagerank': [
            {
                'rank': i + 1,
                'username': item['username'],
                'pagerank': item['pagerank'],
                'followers': item['followers'],
                'divergence': next((d['divergence'] for d in divergences if d['twitter_id'] == item['twitter_id']), 0)
            }
            for i, item in enumerate(by_pagerank[:50])
        ],
        'biggest_divergences': [
            {
                'username': item['username'],
                'pr_rank': item['pr_rank'],
                'follower_rank': item['follower_rank'],
                'divergence': item['divergence'],
                'followers': item['followers'],
                'bio': item['bio']
            }
            for item in sorted_div[:10]
        ],
        'communities': [
            {
                'id': comm_id,
                'size': len(members),
                'top_members': [
                    users.get(m, {}).get('username') or core_nodes.get(m, {}).get('username', '?')
                    for m, _ in sorted([(m, pagerank.get(m, 0)) for m in members], key=lambda x: -x[1])[:5]
                ]
            }
            for comm_id, members in sorted(communities.items(), key=lambda x: -len(x[1]))[:10]
        ]
    }
    
    with open('network_analysis_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print("   Results saved to network_analysis_results.json")
    print()
    print("=" * 70)
    print("ANALYSIS COMPLETE")
    print("=" * 70)

if __name__ == '__main__':
    main()
