.PHONY: dev start seed typecheck lint ci test bench verify e2e security-scan

# Frontend only (DEMO · OFFLINE — proxy to :3001 will be refused, that's expected)
dev:
	npm run dev

# Full live stack: QVAC backend (:3001) + web app (:5173) → LIVE · QVAC
start:
	npm run start

# Ingest the Northwind dossier into the running backend (run after `make start`)
seed:
	curl -X POST http://localhost:3001/api/seed

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
