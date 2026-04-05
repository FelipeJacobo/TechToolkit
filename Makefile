# Makefile — AI Dev Assistant V4
.PHONY: up down logs build seed restart clean health

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

build:
	docker compose build

seed:
	docker compose exec api npx tsx seed.ts

restart:
	docker compose restart

clean:
	docker compose down -v
	rm -rf node_modules apps/api/node_modules apps/web/node_modules

health:
	docker compose ps

# Dev shortcuts
dev-api:
	cd apps/api && npm run dev

dev-web:
	cd apps/web && npm run dev

dev-agent:
	npm run dev
