# Security Policy

## Supported Versions

| Version | Supported          |
|---------|-------------------|
| 1.x     | ✅ Current release |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Email**: security@edycu.dev
2. **Do NOT** open a public GitHub issue for security vulnerabilities
3. Include steps to reproduce the vulnerability
4. Allow 48 hours for initial response

## Security Measures

This project is designed for **zero-cloud, offline execution**:

- ❌ No external API calls
- ❌ No data exfiltration
- ❌ No telemetry
- ✅ All inference runs locally via `@qvac/sdk`
- ✅ No secrets required (fully keyless)
- ✅ MIT licensed, fully open source

## CI Security Pipeline

- **TruffleHog**: Scans for committed secrets
- **npm audit**: Dependency vulnerability scanning
- **CodeQL**: Static Application Security Testing (SAST)
- **Dependabot**: Automated dependency updates
- **License checker**: Ensures no GPL contamination
