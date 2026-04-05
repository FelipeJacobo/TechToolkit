# AI Dev Assistant V4 — SaaS Platform

Plataforma SaaS multi-tenant de agentes de desarrollo con IA. Analiza código, encuentra vulnerabilidades, aplica fixes automáticamente y deja trazabilidad completa.

---

## 📋 Requisitos

- **Docker** + **Docker Compose** (v2 recomendado)
- **8 GB RAM** mínimo
- **OpenAI API Key** (para análisis y agent core)
- **Node.js 20+** (solo si corres en desarrollo local)

---

## 🚀 Instalación Paso a Paso

### Paso 1: Descomprimir

```bash
unzip ai-dev-assistant-v4-clean.zip
cd ai-dev-assistant-v4-clean
```

### Paso 2: Configurar variables de entorno

```bash
cp .env.example .env
nano .env
```

Edita `.env` y agrega tu API key:

```env
OPENAI_API_KEY=sk-proj-tu-api-key-aquí
JWT_SECRET=genera-un-secret-aleatorio-de-32-caracteres
ANALYSIS_MODEL=gpt-4o
AGENT_MODEL=gpt-4o
```

> ⚠️ **Sin `OPENAI_API_KEY`** la plataforma corre pero el agent core no puede analizar código. El resto (auth, dashboard, proyectos) funciona igual.

### Paso 3: Levantar con Docker

```bash
docker compose up -d --build
```

Esto levanta 6 servicios automáticamente:

| Servicio | Puerto | Función |
|---|---|---|
| PostgreSQL | 5432 | Base de datos + pgvector |
| Redis | 6379 | Cache + rate limiting |
| NATS | 4222 | Message bus (JetStream) |
| API | 8081 | Backend Fastify |
| Web | 3000 | Frontend Next.js |
| Agent Core | 8080 | Orchestrator + Planner + Executor + Critic |

### Paso 4: Verificar que todo esté up

```bash
docker compose ps
```

Todos deberían estar en estado `healthy`. Si alguno está `starting`, esperá 30-60 segundos.

### Paso 5: Cargar datos demo

```bash
docker compose exec api npx tsx seed.ts
```

Esto crea:
- 3 proyectos de ejemplo
- 9 runs con logs
- Usuario demo

### Paso 6: Abrir la app

- **Web App:** http://localhost:3000
- **API:** http://localhost:8081
- **Agent Core:** http://localhost:8080

### Paso 7: Login

| Campo | Valor |
|---|---|
| Email | demo@acme.dev |
| Password | demo1234 |

---

## 🛑 Detener

```bash
# Parar todo (datos persistentes en volúmenes)
docker compose down

# Parar + borrar volúmenes (reset total)
docker compose down -v
```

---

## 🔧 Desarrollo Local (sin Docker)

```bash
# 1. Instalar dependencias
cd apps/api && npm install && cd ../..
cd apps/web && npm install && cd ../..
npm install

# 2. Levantar infraestructura externa (Postgres, Redis, NATS)
#    Podés usar Docker solo para infra:
docker compose up -d postgres redis nats

# 3. Seed
npx tsx seed.ts

# 4. Iniciar servicios en terminales separadas:
cd apps/api && npm run dev    # API → :8081
cd apps/web && npm run dev    # Web → :3000
npm run dev                   # Agent Core → :8080
```

---

## 🧪 Tests

```bash
# E2E (requiere API corriendo en :8081)
cd apps/api && npm run test:e2e
```

---

## 📁 Estructura

```
├── apps/api/src/         ← SaaS API (Fastify): auth, proyectos, runs, NATS
├── apps/web/             ← Next.js: landing, dashboard, proyectos, runs, chat
├── src/                  ← Agent Core: Planner → Executor → Critic
├── vscode-extension/     ← VS Code extension: analizar código desde el editor
├── docker/               ← Dockerfiles multi-stage
├── migrations/           ← Esquemas SQL
├── tests/                ← E2E + unit tests
├── docs/                 ← Documentación completa
└── docker-compose.yml   ← Infra completa (6 servicios)
```

---

## ⚙️ Variables de Entorno

| Variable | Default | Descripción |
|---|---|---|
| `OPENAI_API_KEY` | (vacío) | **Requerida** para agent core |
| `JWT_SECRET` | `super-secret-jwt-key-change-me` | Signing key JWTs |
| `ANALYSIS_MODEL` | `gpt-4o` | Modelo para análisis de código |
| `AGENT_MODEL` | `gpt-4o` | Modelo para planner/executor |
| `DATABASE_URL` | auto | Configurado por docker-compose |
| `REDIS_URL` | auto | Configurado por docker-compose |
| `NATS_SERVERS` | auto | Configurado por docker-compose |

---

## 🛸 VS Code Extension

```bash
cd vscode-extension
npm install
npm run build
# Opción A: F5 en VS Code (debug)
# Opción B: vsce package → instalar .vsix
```

---

## 📊 Arquitectura

```
Frontend → /agent/run-task → API (Fastify)
  → NATS JetStream: agent.run.request
    → Agent Core: Orchestrator → Planner → Executor → Critic
      → NATS: tenant.*.events
        → API consumer → Postgres (logs, traces, status)
```

Ver `docs/ARCHITECTURE.md` para detalles completos.

---

## 🐛 Estado Actual

| Componente | Estado |
|---|---|
| Frontend (18 páginas) | ✅ Completo |
| Backend API (15+ endpoints) | ✅ Completo |
| Agent Core (pipeline v2) | ✅ Completo |
| VS Code Extension | ✅ MVP |
| Docker (6 servicios) | ✅ Completo |
| Tests E2E | ✅ 17 tests |
| Stripe billing | ⚠️ Falta webhook |
| GitHub integration | ⚠️ Falta webhook |
| CI/CD | ⚠️ Falta contenido |

---

## 📖 Documentación Adicional

- `docs/ARCHITECTURE.md` — Arquitectura detallada
- `docs/DEPLOYMENT.md` — Guía de deploy (VPS, SSL, dominio)
- `docs/SECURITY.md` — Seguridad y hardening
- `docs/SCALING.md` — Escalamiento horizontal
- `docs/BACKUPS.md` — Estrategia de backups
- `docs/RUNBOOKS.md` — Operaciones y troubleshooting
- `docs/SLA.md` / `docs/SUPPORT.md` — SLA y soporte
