/* The current peer snapshot and interaction state have one dashboard owner. */
(function (global) {
    'use strict';
    function create() {
        let peers = [];
        let byId = new Map();
        const distribution = global.BPMDistributionState.create();
        const privateNetwork = global.BPMPrivateNetworkState.create();
        const interaction = { highlightedPeerId: null, mapFilterPeerIds: null, groupedNodes: null, asFilterPeerIds: null, asLinePeerIds: null, asLineColor: null, asLineAsNum: null, asLineGroups: null, enabledNets: new Set(['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns']), hoveredNode: null, pinnedNode: null };
        function replace(snapshot) {
            if (snapshot === peers) return;
            peers = snapshot;
            byId = new Map(peers.map(peer => [peer.id, peer]));
            if (!byId.has(distribution.hoveredPeerId)) distribution.hoveredPeerId = null;
            if (!byId.has(interaction.highlightedPeerId)) interaction.highlightedPeerId = null;
            if (interaction.hoveredNode && !byId.has(interaction.hoveredNode.peerId)) interaction.hoveredNode = null;
            if (interaction.pinnedNode && !byId.has(interaction.pinnedNode.peerId)) interaction.pinnedNode = null;
        }
        return Object.freeze({
            get peers() { return peers; },
            get byId() { return byId; },
            distribution, privateNetwork, interaction, replace,
        });
    }
    global.BPMDashboardState = Object.freeze({ create });
    global.BPMDashboard = create();
})(window);
