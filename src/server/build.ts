export const GITHUB_REPOSITORY = 'spyhunter493/Bitcoin-Peer-Map';
export const REPOSITORY_URL = `https://github.com/${GITHUB_REPOSITORY}`;

// Stable SemVer tags also need to fit a Docker tag (128 characters).
export function parseReleaseVersion(value: unknown) {
    if (typeof value !== 'string' || value.length > 128) return null;
    const match = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(value);
    return match ? [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)] as const : null;
}

export function isNewerRelease(installed: string, latest: string) {
    const current = parseReleaseVersion(installed), candidate = parseReleaseVersion(latest);
    if (!current || !candidate) return false;
    for (let index = 0; index < current.length; index++) {
        if (candidate[index] !== current[index]) return candidate[index]! > current[index]!;
    }
    return false;
}
