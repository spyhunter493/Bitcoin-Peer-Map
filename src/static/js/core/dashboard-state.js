import * as BPMDistributionState from '../distribution/state.js';
import * as BPMPrivateNetworkState from '../peers/private-state.js';
function create() {
    /** @type {import('../types').Peer[]} */
    let peers = [];
    /** @type {Map<number, import('../types').Peer>} */
    let byId = new Map();
    const distribution = BPMDistributionState.create();
    const privateNetwork = BPMPrivateNetworkState.create();
    /** @type {import('../types').MapInteraction} */
    const interaction = {
        highlightedPeerId: null,
        mapFilterPeerIds: null,
        groupedNodes: null,
        groupSelection: null,
        asFilterPeerIds: null,
        asLinePeerIds: null,
        asLineColor: null,
        asLineAsNum: null,
        asLineGroups: null,
        enabledNets: new Set(['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns']),
        hoveredNode: null,
        pinnedNode: null,
    };
    /** @param {import('../types').Peer[]} snapshot */
    function replace(snapshot) {
        if (snapshot === peers) return;
        peers = snapshot;
        byId = new Map(peers.map((peer) => [peer.id, peer]));
        if (distribution.hoveredPeerId !== null && !byId.has(distribution.hoveredPeerId)) distribution.hoveredPeerId = null;
        if (interaction.highlightedPeerId !== null && !byId.has(interaction.highlightedPeerId)) interaction.highlightedPeerId = null;
        if (interaction.hoveredNode && !byId.has(interaction.hoveredNode.peerId)) interaction.hoveredNode = null;
        if (interaction.pinnedNode && !byId.has(interaction.pinnedNode.peerId)) interaction.pinnedNode = null;
    }
    return Object.freeze({
        get peers() {
            return peers;
        },
        get byId() {
            return byId;
        },
        distribution,
        privateNetwork,
        interaction,
        replace,
    });
}
export { create };
export const dashboard = create();
