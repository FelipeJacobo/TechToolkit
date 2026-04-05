# FASE 2: NUEVA ARQUITECTURA — TechToolKit SaaS

## 🎯 Principios de Diseño

1. **Incremental sobre reescritura**: No tocar lo que funciona (27 módulos, 46 tests)
2. **Separa runtime de gestión**: Desktop = ejecución. Web = gestión/observabilidad.
3. **Plugins, no monolito**: Cada módulo es independiente y reemplazable.
4. **Observability-first**: Logs, métricas y traces desde día 1.
5. **Security-by-default**: Zero trust, principle of least privilege.

---

## 🏛️ Arquitectura Propuesta

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TECHTOOLKIT SAAS PLATFORM                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────────┐ │
│  │   DESKTOP APP    │     │   WEB DASHBOARD  │     │   MOBILE (Futuro)    │ │
│  │   (WPF .NET 8)   │     │   (Next.js 15)   │     │                      │ │
│  │                  │     │                  │     │                      │ │
│  │  • 27 módulos    │     │  • Dashboard     │     │                      │ │
│  │  • Autopilot     │     │  • Reportes      │     │                      │ │
│  │  • Reportes      │     │  • Licencias     │     │                      │ │
│  │  • Sync Engine   │◄───►│  • Analytics     │     │                      │ │
│  │                  │     │  • Administración│     │                      │ │
│  │  [Sync Agent]────┼────►│                  │     │                      │ │
│  └──────────────────┘     └────────┬─────────┘     └──────────────────────┘ │
│                                    │                                        │
│                              HTTPS │ REST + WebSocket                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        API GATEWAY                                    │   │
│  │                     (Kong / Caddy / Nginx)                           │   │
│  │                                                                      │   │
│  │  • Rate Limiting    • Auth Z    • CORS      • SSL Termination        │   │
│  │  • Request Log       • Throttle   • Routing   • Load Balancing       │   │
│  └────────────┬──────────────┬──────────────┬───────────────────────────┘   │
│               │              │              │                               │
│     ┌─────────▼─────┐ ┌─────▼────────┐ ┌───▼───────────────────────┐       │
│     │   AUTH        │ │  CORE API    │ │  WEB SERVICE              │       │
│     │   SERVICE     │ │  SERVICE     │ │  (Next.js API Routes)     │       │
│     │               │ │              │ │                           │       │
│     │ • JWT/OAuth2  │ │ • Modules    │ │ • SSR pages               │       │
│     │ • Sessions    │ │ • Reports    │ │ • Admin panel             │       │
│     │ • API Keys    │ │ • Licenses   │ │ • Blog/Docs               │       │
│     │ • RBAC        │ │ • Users      │ │ • Pricing                 │       │
│     │ • MFA         │ │ • Sync       │ │                           │       │
│     └───────┬───────┘ └──────┬───────┘ └───────────────────────────┘       │
│             │                │                                            │
│             └────────┬───────┘                                            │
│                      │                                                     │
│              ┌───────▼────────┐                                           │
│              │  EVENT BUS     │ ◄── Todos los servicios publican           │
│              │  (RabbitMQ /   │      eventos aquí                          │
│              │   NATS)        │                                            │
│              └───────┬────────┘                                           │
│                      │                                                     │
│     ┌────────────────┼──────────────────┐                                 │
│     │                │                  │                                 │
│     ▼                ▼                  ▼                                 │
│  ┌────────┐    ┌──────────┐    ┌──────────────┐                          │
│  │REPORT   │    │ NOTIF.   │    │ ANALYTICS    │                          │
│  │GENERATOR│    │ SERVICE  │    │ ENGINE       │                          │
│  │         │    │          │    │              │                          │
│  │ • PDF   │    │ • Email  │    │ • Métricas   │                          │
│  │ • HTML  │    │ • Push   │    │ • Dashboards │                          │
│  │ • JSON  │    │ • Slack  │    │ • Alertas    │                          │
│  └────────┘    └──────────┘    └──────────────┘                          │
│                                                                             │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────────┐                 │
│  │   PostgreSQL   │  │   Redis      │  │   Object Store  │                 │
│  │                │  │              │  │   (S3 compatible)│                │
│  │ • Users        │  │ • Session    │  │                 │                 │
│  │ • Licenses     │  │ • Cache      │  │ • Reports       │                 │
│  │ • Sync Data    │  │ • Rate Limit │  │ • Backups       │                 │
│  │ • Audit Log    │  │ • Pub/Sub    │  │ • Avatars       │                 │
│  │ • Metrics      │  │              │  │                 │                 │
│  └────────────────┘  └──────────────┘  └─────────────────┘                 │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────┐     │
│  │                    OBSERVABILITY STACK                              │     │
│  │                                                                    │     │
│  │  • OpenTelemetry (tracing)    • Prometheus (metrics)               │     │
│  │  • Grafana (dashboards)       • Loki (logs)                       │     │
│  │  • Alert Manager (alertas)    • Jaeger (tracing UI)              │     │
│  └───────────────────────────────────────────────────────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📐 Capas Detalladas

### 1. Desktop App (WPF .NET 8) — Se Mantiene

La app desktop **no se reescribe**. Se refactoriza para:

- Agregar un **Sync Agent** que envíe reportes a la API
- Mantener los 27 módulos nativos tal como están
- Agregar soporte para JWT en el sistema de licencias
- Mejorar el AutopilotEngine con feedback del servidor (configuración de optimización basada en datos agregados de todos los usuarios)

```
TechToolkit.Desktop/
├── Domain/           (sin cambios)
├── Application/      (sin cambios en módulos)
│   ├── Modules/      (27 módulos intactos)
│   └── Sync/         (NUEVO: Sync Agent)
├── Core/             (sin cambios + mejoras logging)
│   ├── Logging/      (mejora: Serilog → HTTP sink)
│   └── Security/     (mejora: JWT + HWID)
├── Infrastructure/   (agregar Sync client)
│   ├── ApiClient/    (NUEVO: HTTP client para la API SaaS)
│   └── AI/           (se mantiene)
├── UI/               (sin cambios en XAML)
└── Tests/            (expandir)
```

### 2. API Gateway — NUEVO

**Tecnología**: Caddy (simple, auto-SSL) o Kong (escalable)

```yaml
routes:
  - path: /api/v1/*
    upstream: core-api:8080
  - path: /auth/*
    upstream: auth-service:9000
  - path: /ws/*
    upstream: core-api:8080
    websocket: true
  - path: /*
    upstream: web-frontend:3000

middleware:
  - rate_limit: 100 req/min por IP
  - auth: JWT verification en /api/v1/*
  - cors: config por ambiente
  - ssl: auto desde Let's Encrypt
```

### 3. Core API Service — NUEVO (Principal servicio del SaaS)

**Tecnología**: ASP.NET Core 8 Minimal APIs (consistente con .NET del desktop)

```
api/
├── src/
│   ├── Modules/           # CRUD de módulos y configuraciones
│   │   ├── Dtos/
│   │   ├── Endpoints/
│   │   └── Validators/
│   ├── Reports/           # Generación y almacenamiento de reportes
│   ├── Licenses/          # Gestión de licencias (reemplaza el Fastify actual)
│   │   ├── Dtos/
│   │   ├── Endpoints/
│   │   └── Services/
│   ├── Users/             # Gestión de cuentas
│   ├── Sync/              # Endpoint para sync desde desktop
│   │   ├── Endpoints/
│   │   └── Handlers/       # Procesa datos recibidos del desktop
│   └── Program.cs
├── Domain/                # Entidades y reglas de negocio
├── Infrastructure/        # DB, Redis, S3, Event Bus
└── Tests/
```

**Endpoints principales**:

| Método | Path | Descripción | Auth |
|---|---|---|---|
| POST | /api/v1/auth/register | Registro de cuenta | ❌ |
| POST | /api/v1/auth/login | Login | ❌ |
| POST | /api/v1/auth/refresh | Refresh token | ✅ (token) |
| POST | /api/v1/auth/mfa/setup | Configurar MFA | ✅ |
| POST | /api/v1/sync/upload | Enviar datos desde desktop | ✅ (API Key) |
| GET | /api/v1/sync/config | Obtener config optimizada | ✅ (API Key) |
| GET | /api/v1/modules | Listar módulos disponibles | ✅ |
| GET | /api/v1/reports | Listar reportes del usuario | ✅ |
| GET | /api/v1/reports/{id} | Descargar reporte | ✅ |
| POST | /api/v1/reports/export | Generar reporte | ✅ |
| GET | /api/v1/licenses | Listar licencias del usuario | ✅ |
| POST | /api/v1/licenses/activate | Activar licencia | ✅ |
| GET | /api/v1/analytics/dashboard | Métricas del dashboard | ✅ |
| WS | /ws/realtime | Notificaciones en tiempo real | ✅ |

### 4. Web Frontend — NUEVO (Reemplaza techtoolkit-web)

**Tecnología**: Next.js 15 (App Router) + TypeScript + Tailwind CSS 4

```
web/
├── src/
│   ├── app/                   # App Router
│   │   ├── (auth)/            # Login, register, MFA
│   │   │   ├── login/
│   │   │   ├── register/
│   │   │   └── layout.tsx
│   │   ├── (dashboard)/       # Dashboard principal
│   │   │   ├── layout.tsx      # Sidebar + Header
│   │   │   ├── page.tsx        # Overview
│   │   │   ├── modules/        # Catálogo de módulos
│   │   │   ├── reports/        # Historial de reportes
│   │   │   ├── analytics/      # Métricas y gráficos
│   │   │   ├── licenses/       # Gestión de licencias
│   │   │   └── settings/       # Configuración
│   │   ├── (marketing)/       # Landing page, blog, pricing
│   │   │   ├── page.tsx
│   │   │   ├── pricing/
│   │   │   ├── blog/
│   │   │   └── docs/
│   │   └── api/               # API Routes (proxy)
│   ├── components/            # Design System
│   │   ├── ui/                # Componentes reutilizables
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── table.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── skeleton.tsx    # Loading states
│   │   │   └── empty.tsx       # Empty states
│   │   ├── charts/            # Gráficos (Recharts)
│   │   ├── layout/            # Sidebar, Header, Footer
│   │   └── modules/           # Components por módulo
│   ├── lib/
│   │   ├── api.ts             # API client typed (fetch wrapper)
│   │   ├── auth.ts            # Auth helpers
│   │   ├── utils.ts           # Utilities
│   │   └── query.ts           # React Query setup
│   ├── hooks/                 # Custom hooks
│   ├── stores/                # Zustand stores
│   └── styles/                # Tailwind + CSS variables
├── public/
└── next.config.ts
```

### 5. Auth Service — NUEVO

**Tecnología**: Integrado en Core API (no microservicio separado initially)

```
auth/
├── JwtProvider.cs          # Genera JWT + refresh tokens
├── HwidValidator.cs         # Valida HWID para desktop + migración
├── MfaService.cs            # TOTP para MFA
├── PasswordHasher.cs        # Argon2id (no bcrypt — más seguro contra GPU)
├── SessionManager.cs        # Gestión de sesiones activas
└── RbacProvider.cs          # Roles: admin, user, technician
```

**Flujo de autenticación**:

```
Desktop:
  HWID → POST /api/v1/auth/hwid-login
  Respuesta: { access_token, refresh_token, plan }
  Almacena cifrado (DPAPI)

Web:
  Email + Password → POST /api/v1/auth/login
  Respuesta: { access_token, mfa_required? }
  Si MFA → TOTP → POST /api/v1/auth/mfa/verify

API Key (Desktop sync):
  POST /api/v1/sync/upload
  Header: Authorization: Bearer <api_key>
```

### 6. Database Schema

**Tecnología**: PostgreSQL 16

```sql
-- Usuarios
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL, -- Argon2id
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user',
    mfa_secret VARCHAR(255),
    mfa_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sesiones
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    device_info JSONB,
    last_active TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Licencias
CREATE TABLE licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_key VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    plan VARCHAR(50) NOT NULL, -- 'basic', 'pro', 'enterprise'
    hwid VARCHAR(128),
    hwid_hash VARCHAR(128), -- Hash del HWID (no plain text)
    max_devices INT DEFAULT 1,
    activated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Devices (para multi-device)
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    license_id UUID REFERENCES licenses(id),
    hwid VARCHAR(128),
    hwid_hash VARCHAR(128),
    name VARCHAR(255),
    os_version VARCHAR(50),
    app_version VARCHAR(50),
    last_sync TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync Data (datos recibidos del desktop)
CREATE TABLE sync_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    record_type VARCHAR(50) NOT NULL, -- 'diagnostic', 'scan_result', 'module_log'
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reports
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id),
    report_type VARCHAR(50) NOT NULL, -- 'diagnostic', 'optimization', 'security'
    title VARCHAR(255),
    score_before INT,
    score_after INT,
    file_url VARCHAR(500), -- URL al S3
    status VARCHAR(50) DEFAULT 'processing',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Log
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100),
    resource_id UUID,
    ip_address INET,
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Metrics (time series — considerar TimescaleDB después)
CREATE TABLE metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID REFERENCES devices(id),
    metric_type VARCHAR(50), -- 'cpu', 'ram', 'disk', 'temp'
    value DECIMAL(10,2),
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_licenses_user ON licenses(user_id);
CREATE INDEX idx_reports_user_date ON reports(user_id, created_at DESC);
CREATE INDEX idx_sync_records_device ON sync_records(device_id, created_at DESC);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_metrics_device_time ON metrics(device_id, timestamp DESC);
```

### 7. Event Bus

**Tecnología**: Redis Pub/Sub (simple) → RabbitMQ (escalable)

Eventos publicados por el sistema:

| Evento | Payload | Consumidor |
|---|---|---|
| `user.registered` | { userId, email } | Email service |
| `device.synced` | { deviceId, syncType } | Analytics engine |
| `report.generated` | { reportId, userId, score } | Notification service, Report generator |
| `license.activated` | { licenseId, userId, deviceId } | Email service, Analytics |
| `license.expiring` | { licenseId, daysRemaining } | Notification service |
| `security.alert` | { deviceId, alertType, severity } | Notification service (push/email) |

---

## 🔄 Plan de Migración del Fastify Actual

La API de licencias en Fastify se migra a ASP.NET Core:

**Fase A (paralelo)**: El Fastify sigue funcionando. El nuevo Core API replica los endpoints de licencias usando la misma base de datos.

**Fase B (switch)**: Redirigir el API Gateway para que `/api/licenses/*` apunte al Core API.

**Fase C (retiro)**: Apagar el servidor Fastify una vez que todas las licencias se validen contra el nuevo servicio.

```
Antes:                              Después:
Desktop → Fastify → DB             Desktop → API Gateway → Core API → PostgreSQL
                                        → Auth Service
                                        → Redis
Web → Fastify → DB                 Web → API Gateway → Core API → PostgreSQL
                                        → Next.js SSR
```

---

## 📊 Comparación: Antes vs Después

| Dimensión | Antes | Después |
|---|---|---|
| Auth | HWID + DPAPI | JWT + OAuth2 + MFA + Argon2id |
| Backend | Fastify monolítico | ASP.NET Core modular |
| Frontend | HTML/CSS estático | Next.js 15 App Router |
| DB | No definida | PostgreSQL 16 |
| Cache | Ninguno | Redis |
| Eventos | Ninguno | Redis pub/sub → RabbitMQ |
| Logging | Local, sin estructura | OpenTelemetry + Loki |
| Métricas | Dashboard local | Prometheus + Grafana |
| Tracing | No existe | Jaeger |
| Deploy | Manual | Docker + CI/CD |
| Plugins | No existe | Sistema de módulos dinámicos |
| API | Sin documentación | OpenAPI/Swagger |
