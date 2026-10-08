/** Omission from getnodeaddresses does not establish absence from Addrman.
 * @param {unknown} status */
export function addrmanLabel(status) {
    if (status === 'present') return 'Yes';
    if (status === 'not_returned') return 'Not returned';
    return 'Unavailable';
}
