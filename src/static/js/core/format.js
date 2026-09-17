/* Shared display formatting; compact alternatives remain at their call sites. */
(function (global) {
    'use strict';
    const connectionTypes = Object.freeze({
        'outbound-full-relay': 'Outbound Full Relay',
        'block-relay-only': 'Block Relay Only',
        manual: 'Manual', 'addr-fetch': 'Address Fetch', feeler: 'Feeler', inbound: 'Inbound',
    });
    function serviceFlagDescription(flag) {
        return flag.rpc ? flag.label + ' (' + flag.rpc + ')' : flag.label;
    }
    function fmtBytes(bytes) {
        if (bytes == null || isNaN(bytes)) return '\u2014';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1073741824).toFixed(2) + ' GB';
    }

    function fmtDuration(seconds) {
        if (!seconds || seconds <= 0) return '\u2014';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (days > 0) return days + 'd ' + hours + 'h';
        if (hours > 0) return hours + 'h ' + minutes + 'm';
        return minutes + 'm';
    }

    global.BPMFormat = Object.freeze({ fmtBytes, fmtDuration, connectionTypes, serviceFlagDescription });
})(window);
