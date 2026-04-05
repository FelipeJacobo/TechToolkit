# TechToolkit PRO

> Suite profesional de optimización, diagnóstico y mantenimiento para Windows — con ecosistema web e inteligencia artificial integrada.

---

## 📋 ¿Qué es?

TechToolkit PRO es un ecosistema de software compuesto por tres componentes:

| Componente | Qué es | Estado |
|---|---|---|
| **App Desktop** | Aplicación WPF (.NET 8) para diagnóstico y optimización de Windows | ✅ Producción |
| **Web Panel** | Portal web (Next.js) para gestión de licencias, documentación y posiblemente SaaS | 🚧 En desarrollo |
| **AI Dev Assistant** | Agentes de IA (planner, executor, critic) para acelerar el desarrollo del propio proyecto | 🚧 En desarrollo |

**La app desktop es el producto principal.** El web y los agentes de IA son herramientas complementarias — el web para gestión/administración del ecosistema y los agentes para automatizar el desarrollo del proyecto.

---

## 🏗️ Arquitectura General

```
┌─────────────────────────────────────────────────────────────────┐
│                     TECHTOOLKIT ECOSYSTEM                        │
├──────────────────────┬──────────────────┬────────────────────────┤
│   DESKTOP (Producto) │     WEB (Panel)  │  AI AGENTS (Dev Tool)  │
│                      │                  │                        │
│  ┌──────────────┐    │  ┌────────────┐  │  ┌──────────────────┐  │
│  │  WPF UI (C#) │    │  │  Next.js   │  │  │ Planner Agent   │  │
│  └──────┬───────┘    │  └──────┬─────┘  │  ├──────────────────│  │
│         │             │        │         │  │ Executor Agent   │  │
│  ┌──────┴───────┐    │  ┌─────┴──────┐  │  ├──────────────────│  │
│  │ Application  │    │  │   API      │  │  │ Critic Agent    │  │
│  │  (Business   │    │  │ (Fastify)  │  │  └──────────────────┘  │
│  │   Logic)     │    │  └──────┬─────┘  │                        │
│  └──────┬───────┘    │         │        │  ┌──────────────────┐  │
│         │             │         │        │  │ 33 IA Skills     │  │
│  ┌──────┴───────┐    │  ┌──────┴──────┐ │  │ (.trae/skills/)  │  │
│  │  Domain      │    │  │  Next.js    │ │  └──────────────────┘  │
│  │ (Models &    │    │  │  Frontend   │ │                        │
│  │  Interfaces) │    │  │  (Marketing │  OpenRouter API          │
│  └──────────────┘    │  │  + Admin)   │  └────────────────────────┘
│         ▲             └──────┬───────┘
│         │        (HTTP/REST para licencias y datos)
│  ┌──────┴───────┐
│  │  Core        │
│  │ (Native API, │
│  │  Crypto, Log)│
│  └──────────────┘
│         ▲
│  ┌──────┴───────┐
│  │Infrastructure│
│  │ (WMI, WMI,   │
│  │  Security,   │
│  │  AI Module)  │
│  └──────────────┘
└─────────────────────────────────────────────────────────────────┘
```

### Flujo de comunicación

```
┌──────────────┐   HWID + License Key    ┌──────────────┐
│  App Desktop │ ──────────────────────▶ │   Web API    │
│  (WPF/.NET)  │ ◀────────────────────── │  (Fastify)   │
│              │   License Status + Token │  + Database  │
│  Autopilot   │                         │              │
│  Engine      │                         │  Admin Panel │
│  (One-Click) │                         │  (Next.js)   │
└──────────────┘                         └──────────────┘
```

---

## 🧩 Módulos de la App Desktop (27 módulos nativos)

Cada módulo ejecuta operaciones nativas de Windows (P/Invoke, sin PowerShell):

| Categoría | Módulos |
|---|---|
| **Backup** | Registry Backup, System Restore Point |
| **Limpieza** | DNS Cache, Prefetch, Recycle Bin, System Logs, Temp Files, Windows Update Cache, Crash Dumps |
| **Diagnóstico** | CPU Info, Disk Health, RAM Health, Smart Disk Health |
| **Red** | Flush DNS, Ping Test, Network Reset, Network Info |
| **Optimización** | Drivers Manager, Power Plan, Services Optimizer, Startup Optimizer, Windows Update Manager |
| **Reparación** | System Repair (SFC + DISM + System Integrity) |
| **Seguridad** | Defender Status, Firewall Check, UAC Check |

---

## 🖥️ Pantallas Principales

| Pantalla | Función |
|---|---|
| Dashboard | Métricas en vivo (CPU, RAM, Disco, Temp), score del sistema, alertas de seguridad |
| Módulos | Biblioteca de 27 herramientas con búsqueda y filtros |
| Reportes | Exportación de diagnósticos (PDF/HTML/JSON con QuestPDF) |
| Logs | Historial de ejecuciones con filtros |
| Configuración | Tema de la app, retención de logs, inicio automático |
| Licencia | Activación PRO por clave o HWID, período de prueba de 7 días |

---

## 🤖 Inteligencia Artificial

### Agentes de IA en Desarrollo (`ai-dev-assistant-v4-clean/`)
- **Planner**: Planifica tareas de desarrollo y refactoring
- **Executor**: Implementa el código planificado
- **Critic**: Revisa código generado y sugiere mejoras

### 33 Skills de IA (`.skills/` y `.trae/skills/`)

Organizados en 7 categorías:

| Categoría | Ejemplos |
|---|---|
| **Generadores** | Module Generator, ViewModel Generator, Unit Test Generator |
| **Arquitectura** | Clean Architecture Validator, MVVM Pattern Enforcer |
| **UI/UX** | Animation Optimizer, Theme Consistency Validator, UI Auto Generator |
| **Optimización** | Module Load Optimizer, Memory Leak Detector, Startup Optimizer |
| **Seguridad** | Script Injection Guard, License Tampering Detector |
| **Pruebas** | Chaos Testing Engine, E2E Test Generator, Test Coverage Analyzer |
| **IA Aplicada** | AI Code Reviewer, AI Refactor Engine, AI Bug Fixer |

### AI Module en Infrastructure
`TechToolkit.Infrastructure/AI/` — Integración con OpenRouter para funcionalidades de IA dentro de la app (posible asistente integrado o análisis de sistema).

---

## 🔒 Sistema de Licencias

| Función | Implementación |
|---|---|
| Identificación del equipo | HWID (hardware ID único) |
| Activación | API real con servidor de licencias |
| Almacenamiento seguro | DPAPI de Windows (cifrado nativo) |
| Período de prueba | 7 días gratis con todas las funciones PRO |
| Generador de licencias | `LicenseGeneratorConsole/` (uso interno) |

---

## 🚀 Ejecutar el Proyecto

### App Desktop (WPF)

```bash
# Requisito: .NET 8 SDK en Windows

# Clonar el repositorio
git clone <url>
cd TechToolkit

# Restaurar dependencias
dotnet restore

# Compilar
dotnet build --configuration Release

# Ejecutar
dotnet run --project TechToolkit.UI

# Ejecutar tests
dotnet test TechToolkit.Tests
```

### Web Panel (Next.js)

```bash
cd techtoolkit-web
npm install
npm run dev
```

### API Backend (Fastify/Node.js)

```bash
cd ai-dev-assistant-v4-clean/apps/api
npm install
npm run dev
```

---

## 📁 Estructura del Proyecto

```
TechToolkit/
├── TechToolkit.Domain/              # Capa de dominio: interfaces, modelos, enums
├── TechToolkit.Application/         # Reglas de negocio y 27 módulos
│   ├── Common/                      # Servicios compartidos
│   ├── Modules/                     # Backup, Cleaning, Diagnostics...
│   ├── Services/                    # Servicios de la aplicación
│   └── Models/                      # Modelos de aplicación
├── TechToolkit.Core/                # Utilidades: logging, crypto, APIs nativas
│   ├── Execution/                   # Motor de ejecución de módulos
│   ├── Native/                      # P/Invoke de Windows
│   ├── Security/                    # Crypto, HWID, licencias
│   ├── Logging/                     # Logger estructurado
│   └── Helpers/                     # Helpers reutilizables
├── TechToolkit.Infrastructure/      # Implementaciones concretas
│   ├── AI/                          # Integración con OpenRouter
│   ├── Security/                    # Seguridad y validación de licencias
│   ├── Services/                    # Servicios de infraestructura
│   └── Helpers/                     # Helpers de infraestructura
├── TechToolkit.UI/                  # Interfaz WPF (Views + ViewModels)
│   ├── Views/                       # Pantallas XAML
│   ├── ViewModels/                  # ViewModels (MVVM)
│   ├── Controls/                    # Controles personalizados
│   ├── Commands/                    # Comandos ICommand
│   ├── Converters/                  # Value converters
│   ├── Localization/                # Internacionalización
│   └── Resources/                   # Recursos visuales
├── TechToolkit.Tests/               # Suite de pruebas (46 tests)
│   ├── Unit/                        # Tests unitarios
│   ├── Integration/                 # Tests de integración
│   ├── Performance/                 # Tests de rendimiento
│   └── Modules/                     # Tests de módulos individuales
├── TechToolkit.Plugin.Ping/         # Plugin de ejemplo
├── TechToolkit.Installer/           # Instalador de la aplicación
├── TechToolkit.Publish/             # Builds publicados (win-x64)
├── LicenseGeneratorConsole/         # Generador de licencias (uso interno)
├── techtoolkit-web/                 # Portal web (Next.js)
│   ├── css/, js/, fonts/            # Assets estáticos
│   ├── blog/                        # Sección de blog
│   ├── data/                        # Datos
│   └── modules/                     # Módulos web
├── ai-dev-assistant-v4-clean/       # Agentes de IA para desarrollo
│   ├── apps/api/                    # API backend (Fastify)
│   │   └── agents/                  # Planner, Executor, Critic
│   ├── src/                         # Código fuente principal
│   ├── tests/                       # Tests
│   └── vscode-extension/            # Extensión de VS Code
├── .skills/                         # 33 skills de IA personalizados
├── .trae/                           # Directorio de configuración de IA
├── .continue/                       # Reglas de IDE (Continue)
└── docs/                            # Documentación adicional
```

---

## 🎯 ¿Para quién es?

| Usuario | Beneficio |
|---|---|
| **Técnicos de soporte** | Diagnóstico rápido y reparación automatizada |
| **Usuarios avanzados** | Control total sobre optimización del sistema |
| **Empresas** | Reportes exportables para documentación |
| **Entusiastas** | Monitoreo en tiempo real y mantenimiento preventivo |

---

## ⚙️ Tecnologías

| Capa | Tecnologías |
|---|---|
| Desktop UI | WPF, XAML, C# 12 |
| Desktop Backend | .NET 8.0, P/Invoke (APIs nativas) |
| Patrón | MVVM + Clean Architecture |
| Reportes | QuestPDF (PDF profesional) |
| Web Frontend | Next.js, CSS, JavaScript |
| API Backend | Node.js, Fastify |
| IA | OpenRouter API, agentes autónomos |
| Licencias | HWID + HMAC + DPAPI |
| Tests | xUnit, Moq (46 tests) |
| Dev Tools | 33 IA Skills en `.trae/` |

---

## 📊 Estado Actual

| Área | Estado |
|---|---|
| Compilación | ✅ Exitosa (0 errores) |
| Pruebas unitarias | ✅ 46/46 pasando |
| Módulos nativos | ✅ 27 implementados |
| Interfaz | ✅ 6 pantallas funcionales |
| Temas visuales | ✅ Light/Dark/HighContrast |
| IA Skills | ✅ 33 activos |
| Licencias | ✅ API real + cifrado DPAPI |

---

*TechToolkit PRO — Moderno, limpio y profesional para mantener Windows en óptimas condiciones. 🚀*
