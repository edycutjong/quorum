.PHONY: dev typecheck lint ci test bench verify e2e security-scan

dev:
	npm run dev

typecheck:
	npm run typecheck

lint:
	npm run lint

ci:
	npm run ci

test:
	npm run test

bench:
	npm run bench

bench-assert:
	npm run bench -- --assert

verify:
	python3 scripts/verify_offline.py

readiness:
	python3 scripts/check_submission_readiness.py

e2e:
	npm run e2e

security-scan:
	npx trufflehog filesystem . --only-verified 2>/dev/null || echo "Install trufflehog for secret scanning"
	npm audit --audit-level=high || true
