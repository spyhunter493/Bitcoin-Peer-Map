# Mounted-secret permissions and startup tests

Status: implemented. This document records the permission guidance and real-mount
startup checks delivered by this PR.

This is the third of three ordered implementation plans. It clarifies password-file permissions and proves startup behavior with real Compose file-backed secrets.

## Documentation changes

- Explain that the production image runs as UID/GID 10001 and that an operator-owned 0600 password file may therefore be unreadable inside the container.
- Document two rootful Linux host-file patterns: ownership 10001:10001 with mode 0600, or operator ownership with group 10001 and mode 0640.
- Explain that file-backed Compose secrets use bind mounts and preserve host permissions. Secret uid, gid, and mode overrides do not correct these file-backed mounts. Link to [Docker's secrets reference](https://docs.docker.com/reference/compose-file/services/#secrets).
- Add a container preflight that reports its identity and checks readability of the mounted path without printing the password. Keep BITCOIN_RPC_PASSWORD empty when using BITCOIN_RPC_PASSWORD_FILE.
- Explain that rootless/user-namespace deployments need the mapped host identity rather than assuming host UID/GID 10001. Use the same readability probe to confirm access.

## Real-mount acceptance tests

Extend the production container smoke coverage with an isolated Compose project, the production image, a mock RPC server, and an actual file-backed secret. Keep fixtures independent of operator credentials and local Compose overrides.

- Prove successful startup with both documented readable permission patterns.
- Assert the default runtime identity remains UID/GID 10001 and the service retains non-root/read-only operation.
- Verify the mock RPC receives authentication derived from the mounted password, not a direct password environment variable.
- Verify an incompatible owner-only file causes startup to fail before RPC authentication, with a clear unreadable-file error.
- Confirm neither logs nor configuration responses disclose the password.
- Remove fixture containers, volumes, and temporary files in cleanup, including failure paths.

## Validation and boundaries

Validation uses configuration tests, Compose deployment tests, a production image build, and container smoke tests. Permission acceptance tests run on rootful Linux CI; documentation also explains mapped identities for rootless/user-namespace deployments.

Keep image ownership and runtime safeguards unchanged. Do not add a root startup workaround, broaden secret permissions automatically, or add production dependencies.

The implementation updates the operator guide and runs all three actual mounted-file
permission cases through the production container smoke test.
