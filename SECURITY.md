# Security

Cozy-Fi Studio supports one trusted user, running on loopback or through an authenticated SSH tunnel. It does not implement user accounts, tenant isolation, or per-project authorization. Do not deploy it as an internet-facing service.

Request protections include loopback peer validation, exact trusted hosts, cross-origin request rejection, a restrictive script CSP, frame blocking, MIME sniffing protection, upload size limits, and generic dependency error responses. Runtime paths and credentials are not included in job status responses. Media downloads validate public destinations and pin connections to validated addresses; local audio decoding rejects playlists and network protocols.

The application processes complex media using native libraries and FFmpeg. Keep Python, FFmpeg, Chromium, and dependencies patched. Run as an unprivileged user, restrict filesystem access, and only open media you trust. A local application is not a sandbox for hostile files.

Credentials belong in environment variables or your service manager, never in the repository. If a credential is exposed, revoke and replace it at the provider; deleting it from source does not invalidate it. Do not include API keys, local paths, private media, or raw exception dumps in issues.

Report vulnerabilities through the repository's private security advisory feature if enabled. Otherwise contact the maintainer privately before sharing reproduction details publicly.

Deployment guidance follows the [Flask security documentation](https://flask.palletsprojects.com/en/stable/web-security/) and [Waitress deployment documentation](https://flask.palletsprojects.com/en/stable/deploying/waitress/). HTTP is restricted to loopback; remote transport encryption and authentication are supplied by SSH. HSTS is not set on the local HTTP endpoint.
