# Contributing

Thank you for your interest in contributing! This project was built for the **QVAC Hackathon I — Unleash Edge AI** (DoraHacks, June 2026).

## Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run the quality gate: `make ci`
5. Run offline verification: `make verify`
6. Commit: `git commit -m "feat: description"`
7. Push and open a Pull Request

## Code Standards

- **TypeScript**: Strict mode, no `any` unless explicitly justified
- **All inference**: Must go through `@qvac/sdk` — no cloud APIs
- **Tests**: Target 100+ assertions
- **Linting**: ESLint must pass
- **Commits**: Follow [Conventional Commits](https://www.conventionalcommits.org/)

## Pull Request Requirements

- [ ] `npm run ci` passes (lint + typecheck + test)
- [ ] `python3 scripts/verify_offline.py` passes
- [ ] No cloud API imports
- [ ] Description explains what and why

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
