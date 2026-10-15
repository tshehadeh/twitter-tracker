#!/usr/bin/env python3
"""
Optimized Network Analysis
- Only analyzes nodes followed by 2+ VCs (signal, not noise)
- Uses NetworkX for fast PageRank
- Uses python-louvain for fast community detection
- Pre-computes aggregates in SQL
"""

import sqlite3
import json
import sys
from collections import defaultdict
from datetime import datetime

# Install dependencies if needed
def ensure_packages():
    try:
        import networkx
        import community
        return True
    except ImportError:
        print("Installing required packages...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "networkx", "python-louvain", "-q"])
        return True

ensure_packages()
import networkx as nx
import community as community_louvain

DB_PATH = 'data/tracker.db'

def main():
    print()
    print("=" * 70)
    print("OPTIMIZED NETWORK ANALYSIS")
    print("=" * 70)
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    sys.stdout.flush()
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # ==========================================================================
    # 1. GET EDGE DATA (optimized SQL)
    # ==========================================================================
    print("1. EXTRACTING EDGES")
    print("-" * 40)
    sys.stdout.flush()
    
    # Check which table has data
    cursor.execute("SELECT COUNT(*) as c FROM follows")
    follows_count = cursor.fetchone()['c']
    
    cursor.execute("SELECT COUNT(*) as c FROM new_follows")
    new_follows_count = cursor.fetchone()['c']
    
    print(f"   follows table: {follows_count:,} rows")
    print(f"   new_follows table: {new_follows_count:,} rows")
    
    if follows_count > 0:
        edge_table = "follows"
    else:
        edge_table = "new_follows"
    
    print(f"   Using: {edge_table}")
    sys.stdout.flush()
    
    # Get all edges
    cursor.execute(f"""
        SELECT cn.twitter_id as source, u.twitter_id as target
        FROM {edge_table} f
        JOIN core_nodes cn ON f.core_node_id = cn.id
        JOIN users u ON f.followed_user_id = u.id
    """)
    all_edges = [(row['source'], row['target']) for row in cursor.fetchall()]
    print(f"   Total edges: {len(all_edges):,}")
    sys.stdout.flush()
    
    # ==========================================================================
    # 2. FILTER TO HIGH-SIGNAL NODES (followed by 2+ VCs)
    # ==========================================================================
    print("\n2. FILTERING TO HIGH-SIGNAL NODES")
    print("-" * 40)
    sys.stdout.flush()
    
    # Count how many VCs follow each user
    vc_follow_counts = defaultdict(int)
    for source, target in all_edges:
        vc_follow_counts[target] += 1
    
    # Filter to nodes with 2+ VC follows
    MIN_VC_FOLLOWS = 2
    high_signal_nodes = {node for node, count in vc_follow_counts.items() if count >= MIN_VC_FOLLOWS}
    
    print(f"   Nodes with 1 VC follow: {sum(1 for c in vc_follow_counts.values() if c == 1):,}")
    print(f"   Nodes with 2+ VC follows: {len(high_signal_nodes):,}")
    print(f"   Nodes with 5+ VC follows: {sum(1 for c in vc_follow_counts.values() if c >= 5):,}")
    print(f"   Nodes with 10+ VC follows: {sum(1 for c in vc_follow_counts.values() if c >= 10):,}")
    sys.stdout.flush()
    
    # Get core node IDs
    cursor.execute("SELECT twitter_id FROM core_nodes")
    core_node_ids = {row['twitter_id'] for row in cursor.fetchall()}
    print(f"   Core nodes: {len(core_node_ids):,}")
    
    # Include core nodes in the analysis set
    analysis_nodes = high_signal_nodes | core_node_ids
    print(f"   Total nodes for analysis: {len(analysis_nodes):,}")
    sys.stdout.flush()
    
    # Filter edges to only those between analysis nodes
    filtered_edges = [(s, t) for s, t in all_edges if s in analysis_nodes and t in analysis_nodes]
    print(f"   Filtered edges: {len(filtered_edges):,}")
    sys.stdout.flush()
    
    # ==========================================================================
    # 3. BUILD GRAPH
    # ==========================================================================
    print("\n3. BUILDING GRAPH")
    print("-" * 40)
    sys.stdout.flush()
    
    G = nx.DiGraph()
    G.add_edges_from(filtered_edges)
    
    print(f"   Nodes: {G.number_of_nodes():,}")
    print(f"   Edges: {G.number_of_edges():,}")
    sys.stdout.flush()
    
    # ==========================================================================
    # 4. PAGERANK (fast with NetworkX)
    # ==========================================================================
    print("\n4. COMPUTING PAGERANK")
    print("-" * 40)
    print("   Damping factor: 0.85")
    print("   Running...")
    sys.stdout.flush()
    
    start = datetime.now()
    pagerank = nx.pagerank(G, alpha=0.85, max_iter=100, tol=1e-6)
    elapsed = (datetime.now() - start).total_seconds()
    
    print(f"   ✓ Done in {elapsed:.1f}s")
    print(f"   Nodes ranked: {len(pagerank):,}")
    sys.stdout.flush()
    
    # ==========================================================================
    # 5. COMMUNITY DETECTION (only on smaller subgraph if needed)
    # ==========================================================================
    print("\n5. COMMUNITY DETECTION")
    print("-" * 40)
    sys.stdout.flush()
    
    # If graph is large, sample for community detection
    if G.number_of_nodes() > 50000:
        print(f"   Graph too large ({G.number_of_nodes():,} nodes), sampling top 20k by PageRank...")
        top_nodes = sorted(pagerank.keys(), key=lambda x: -pagerank[x])[:20000]
        G_sample = G.subgraph(top_nodes).copy()
        print(f"   Sampled subgraph: {G_sample.number_of_nodes():,} nodes, {G_sample.number_of_edges():,} edges")
    else:
        G_sample = G
    
    print("   Converting to undirected...")
    G_undirected = G_sample.to_undirected()
    
    print("   Running Louvain algorithm...")
    sys.stdout.flush()
    
    start = datetime.now()
    partition = community_louvain.best_partition(G_undirected, resolution=1.0)
    elapsed = (datetime.now() - start).total_seconds()
    
    # Group by community
    communities = defaultdict(set)
    for node, comm_id in partition.items():
        communities[comm_id].add(node)
    
    modularity = community_louvain.modularity(partition, G_undirected)
    
    print(f"   ✓ Done in {elapsed:.1f}s")
    print(f"   Communities found: {len(communities)}")
    print(f"   Modularity: {modularity:.4f}")
    sys.stdout.flush()
    
    # ==========================================================================
    # 6. GET USER METADATA
    # ==========================================================================
    print("\n6. FETCHING USER METADATA")
    print("-" * 40)
    sys.stdout.flush()
    
    # Only fetch metadata for nodes we're analyzing
    node_list = list(pagerank.keys())
    
    # Batch fetch in chunks
    users = {}
    chunk_size = 1000
    for i in range(0, len(node_list), chunk_size):
        chunk = node_list[i:i+chunk_size]
        placeholders = ','.join('?' * len(chunk))
        cursor.execute(f"""
            SELECT twitter_id, username, display_name, bio, followers_count 
            FROM users WHERE twitter_id IN ({placeholders})
        """, chunk)
        for row in cursor.fetchall():
            users[row['twitter_id']] = dict(row)
    
    print(f"   Fetched {len(users):,} user records")
    
    # Get core node info
    cursor.execute("SELECT twitter_id, username, firm, followers_count FROM core_nodes")
    core_nodes = {row['twitter_id']: dict(row) for row in cursor.fetchall()}
    print(f"   Fetched {len(core_nodes):,} core node records")
    sys.stdout.flush()
    
    # ==========================================================================
    # 7. BUILD RANKINGS
    # ==========================================================================
    print("\n7. BUILDING RANKINGS")
    print("-" * 40)
    sys.stdout.flush()
    
    ranked_data = []
    for twitter_id, pr_score in pagerank.items():
        info = users.get(twitter_id) or core_nodes.get(twitter_id, {})
        ranked_data.append({
            'twitter_id': twitter_id,
            'username': info.get('username', '?'),
            'pagerank': pr_score,
            'followers': info.get('followers_count', 0) or 0,
            'vc_follows': vc_follow_counts.get(twitter_id, 0),
            'bio': (info.get('bio', '') or '')[:100],
            'community': partition.get(twitter_id, -1),
            'is_core': twitter_id in core_node_ids
        })
    
    # Sort by PageRank
    by_pagerank = sorted(ranked_data, key=lambda x: -x['pagerank'])
    by_followers = sorted(ranked_data, key=lambda x: -x['followers'])
    by_vc = sorted(ranked_data, key=lambda x: -x['vc_follows'])
    
    # Assign ranks
    pr_rank = {item['twitter_id']: i for i, item in enumerate(by_pagerank)}
    fol_rank = {item['twitter_id']: i for i, item in enumerate(by_followers)}
    vc_rank = {item['twitter_id']: i for i, item in enumerate(by_vc)}
    
    for item in ranked_data:
        tid = item['twitter_id']
        item['pr_rank'] = pr_rank.get(tid, 999999)
        item['follower_rank'] = fol_rank.get(tid, 999999)
        item['vc_rank'] = vc_rank.get(tid, 999999)
        item['divergence'] = item['follower_rank'] - item['pr_rank']
    
    print(f"   Ranked {len(ranked_data):,} nodes")
    sys.stdout.flush()
    
    # ==========================================================================
    # 8. PRINT RESULTS
    # ==========================================================================
    print("\n" + "=" * 70)
    print("RESULTS")
    print("=" * 70)
    
    print("\nTOP 50 BY PAGERANK:")
    print("-" * 90)
    print(f"{'Rank':<5} {'Username':<22} {'PageRank':<12} {'Followers':<12} {'VC Follows':<10} {'Δ Rank':<8}")
    print("-" * 90)
    
    for i, item in enumerate(by_pagerank[:50]):
        div = item['divergence']
        div_str = f"+{div}" if div > 0 else str(div)
        marker = " [VC]" if item['is_core'] else ""
        print(f"{i+1:<5} @{item['username']:<20}{marker} {item['pagerank']:.8f}   {item['followers']:<12,} {item['vc_follows']:<10} {div_str:<8}")
    
    print("\n\nLARGEST DIVERGENCES (PageRank >> Follower Count):")
    print("-" * 90)
    
    # Non-core nodes only for divergence (more interesting)
    non_core_ranked = [r for r in ranked_data if not r['is_core']]
    sorted_by_div = sorted(non_core_ranked, key=lambda x: -x['divergence'])[:15]
    
    for item in sorted_by_div:
        print(f"@{item['username']:<22} PR Rank: {item['pr_rank']:<6} Follower Rank: {item['follower_rank']:<6} Δ: +{item['divergence']}")
        print(f"   Followers: {item['followers']:,} | VC Follows: {item['vc_follows']} | {item['bio'][:60]}")
        print()
    
    # Spearman correlations
    print("\nBASELINE COMPARISONS:")
    print("-" * 50)
    
    def spearman(r1, r2, ids):
        n = len(ids)
        if n < 2:
            return 0
        d_sq = sum((r1.get(i, n) - r2.get(i, n)) ** 2 for i in ids)
        return 1 - (6 * d_sq) / (n * (n**2 - 1))
    
    common = set(pr_rank.keys())
    print(f"   PageRank vs Followers:    ρ = {spearman(pr_rank, fol_rank, common):.4f}")
    print(f"   PageRank vs VC Follows:   ρ = {spearman(pr_rank, vc_rank, common):.4f}")
    print(f"   Followers vs VC Follows:  ρ = {spearman(fol_rank, vc_rank, common):.4f}")
    
    print("\n\nTOP COMMUNITIES:")
    print("-" * 50)
    
    sorted_comms = sorted(communities.items(), key=lambda x: -len(x[1]))[:8]
    for comm_id, members in sorted_comms:
        top = sorted([(m, pagerank.get(m, 0)) for m in members], key=lambda x: -x[1])[:5]
        usernames = [users.get(m, core_nodes.get(m, {})).get('username', '?') for m, _ in top]
        print(f"   Cluster {comm_id}: {len(members):,} members")
        print(f"      Top: {', '.join('@' + u for u in usernames)}")
        print()
    
    sys.stdout.flush()
    
    # ==========================================================================
    # 9. EXPORT JSON
    # ==========================================================================
    print("\n" + "=" * 70)
    print("EXPORTING RESULTS")
    print("=" * 70)
    
    results = {
        'generated_at': datetime.now().isoformat(),
        'stats': {
            'total_edges_raw': len(all_edges),
            'analysis_nodes': len(analysis_nodes),
            'analysis_edges': len(filtered_edges),
            'min_vc_follows_threshold': MIN_VC_FOLLOWS,
            'communities': len(communities),
            'modularity': modularity,
            'damping_factor': 0.85,
            'spearman_pr_followers': spearman(pr_rank, fol_rank, common),
            'spearman_pr_vc': spearman(pr_rank, vc_rank, common),
        },
        'top_50_pagerank': [
            {
                'rank': i + 1,
                'username': item['username'],
                'pagerank': item['pagerank'],
                'followers': item['followers'],
                'vc_follows': item['vc_follows'],
                'divergence': item['divergence'],
                'community': item['community'],
                'is_core_node': item['is_core']
            }
            for i, item in enumerate(by_pagerank[:50])
        ],
        'divergences': [
            {
                'username': item['username'],
                'pr_rank': item['pr_rank'],
                'follower_rank': item['follower_rank'],
                'divergence': item['divergence'],
                'followers': item['followers'],
                'vc_follows': item['vc_follows'],
                'bio': item['bio']
            }
            for item in sorted_by_div
        ],
        'communities': [
            {
                'id': comm_id,
                'size': len(members),
                'top_members': [
                    {
                        'username': (users.get(m) or core_nodes.get(m, {})).get('username', '?'),
                        'pagerank': pagerank.get(m, 0),
                    }
                    for m, _ in sorted([(m, pagerank.get(m, 0)) for m in members], key=lambda x: -x[1])[:10]
                ]
            }
            for comm_id, members in sorted_comms
        ]
    }
    
    with open('network_analysis_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print("   ✓ Saved to network_analysis_results.json")
    print()
    print("=" * 70)
    print(f"COMPLETE: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

if __name__ == '__main__':
    main()
