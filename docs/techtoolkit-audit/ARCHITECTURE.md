# ARCHITECTURE.md — TechToolkit PRO

Documento de decisiones arquitectónicas, flujo de datos y justificaciones del ecosistema TechToolkit PRO.

---

## 📐 Visión General: ¿Uno o Dos Productos?

**Respuesta: Un producto principal + herramientas complementarias.**

El ecosistema tiene **tres componentes con propósitos distintos**:

| Componente | Tipo | Propósito |
|---|---|---|
| `TechToolkit.*` (WPF) | **Producto comercial** | App de desktop para optimización de Windows |
| `techtoolkit-web` + API (Fastify) | **Panel complementario** | Portal de licencias, marketing, posible SaaS futuro |
| `ai-dev-assistant-v4-clean` | **Herramienta interna** | Agentes de IA para acelerar el desarrollo del proyecto |

Solo el desktop es el producto que el usuario final descarga e instala. Los otros dos son infraestructura de soporte.

---

## 🏛️ ADR: Decisiones Arquitectónicas

### ADR-001: ¿Por qué Clean Architecture + MVVM?

**Decisión**: Separar el dominio, aplicación, infraestructura y UI en proyectos independientes, con patrón MVVM para la interfaz.

**Razón**: 
- El dominio no depende de nada externo → testeable sin Windows
- La aplicación define reglas de negocio sin saber cómo se ejecutan
- La infraestructura implementa las interfaces con APIs nativas de Windows
- La UI (WPF) es reemplazable sin tocar la lógica

**Consecuencia**: Mayor cantidad de proyectos y archivos, pero cada cambio tiene impacto predecible y localizado.

---

### ADR-002: ¿Por qué sin PowerShell?

**Decisión**: Todas las operaciones de sistema se ejecutan con API nativas de Windows (P/Invoke), no PowerShell.

**Razón**:
- **Seguridad**: Sin ejecución de scripts, no hay riesgo de script injection
- **Rendimiento**: P/Invoke es más rápido que invocar un proceso externo
- **Confiabilidad**: No depende de la política de ejecución de PowerShell del usuario
- **Profesionalismo**: Se siente como software nativo, no como un wrapper de scripts

**Consecuencia**: Más trabajo de implementación (cada operación necesita su código nativo), pero mayor calidad y seguridad.

---

### ADR-003: ¿Por qué existe la API Node.js (Fastify)?

**Decisión**: API independiente en Node.js para gestión de licencias, datos del ecosistema, y posiblemente como backend del panel web.

**Razón**:
- Separa la lógica de licencias de la app de escritorio → más seguro (las claves no están en el binario)
- Permite que el panel web consuma los mismos datos (licencias, métricas, analytics)
- Fastify es más ligero y rápido que Express para APIs REST
- Escala independientemente de la app desktop

**Flujo de comunicación**:
```
App Desktop (WPF) 
    │
    │ POST /api/license/validate  
    │ { hwid, licenseKey }
    ▼
API (Fastify) 
    │
    │ Validez contra DB
    │ Retorna token + status
    ▼
App Desktop (WPF)
    │ Almacena token cifrado (DPAPI)
```

---

### ADR-004: ¿Por qué existe el Frontend Next.js?

**Decisión**: Portal web separado para gestión, documentación y futuro SaaS.

**Posibles propósitos**:
1. **Panel de administración de licencias** — activar/desactivar licencias, ver métricas
2. **Sitio de marketing** — landing page, blog, documentación del producto
3. **Versión SaaS futura** — monitoreo remoto de dispositivos Windows desde la web
4. **Portal de usuario** — historial de diagnósticos, reportes en la nube

**Justificación**: Tener un portal web permite gestionar el ecosistema sin necesidad de la app de escritorio. Un técnico podría revisar las licencias de sus clientes desde el navegador. Un usuario podría ver su historial de diagnósticos desde cualquier dispositivo.

---

### ADR-005: ¿Por qué agentes de IA para desarrollo?

**Decisión**: Mantener agentes de IA (planner, executor, critic) como herramientas internas de desarrollo, NO como funcionalidad del producto.

**Razón**:
- Acelera el desarrollo de los 27 módulos generando boilerplate, tests y documentación
- Los 33 skills en `.trae/` automatizan patrones específicos de WPF, MVVM y Clean Architecture
- Separar estos agentes del producto mantiene la app desktop ligera y enfocada

**Relación con Infrastructure/AI**:
- `ai-dev-assistant-v4-clean/` → Agentes para **desarrollo** (no se distribuyen con la app)
- `TechToolkit.Infrastructure/AI/` → Posible integración de IA **dentro de la app** (ej: asistente de diagnóstico)

---

## 🔄 Flujo de Datos Detallado

### Flujo 1: Validación de Licencia

```
Usuario ingresa clave de licencia
        │
        ▼
┌──────────────────────────────┐
│  TechToolkit.UI              │
│  LicenseView + ViewModel     │
│  - Recibe entrada del usuario │
│  - Genera HWID del equipo    │
└──────────────┬───────────────┘
               │ HWID + LicenseKey
               ▼
┌──────────────────────────────┐
│  TechToolkit.Infrastructure   │
│  Security/LicenseService.cs   │
│  - HttpClient al API externo  │
│  - Valida respuesta           │
└──────────────┬───────────────┘
               │ POST /api/license/validate
               ▼
┌──────────────────────────────┐
│  API Node.js (Fastify)       │
│  - Consulta base de datos     │
│  - Valida HMAC + expiración   │
│  - Retorna token + permisos   │
└──────────────┬───────────────┘
               │ Response { valid, token, plan, expiry }
               ▼
┌──────────────────────────────┐
│  TechToolkit.Infrastructure   │
│  - Cifra token con DPAPI      │
│  - Guarda en almacenamiento   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  TechToolkit.UI              │
│  - Actualiza UI a modo PRO   │
│  - Habilita módulos PRO       │
└──────────────────────────────┘
```

### Flujo 2: Ejecución de un Módulo (ej: Temp Files Cleaner)

```
Usuario hace clic en "Limpiar Archivos Temporales"
        │
        ▼
┌──────────────────────────────┐
│  TechToolkit.UI              │
│  ModulesView + ViewModel     │
│  - RelayCommand.Execute()    │
└──────────────┬───────────────┘
               │ ModuleRequest
               ▼
┌──────────────────────────────┐
│  TechToolkit.Application      │
│  Modules/Cleaning/            │
│  TempFilesCleaner.cs          │
│  - Obtiene rutas de temp      │
│  - Enumera archivos           │
│  - Calcula espacio recuperable│
└──────────────┬───────────────┘
               │ 
               ▼
┌──────────────────────────────┐
│  TechToolkit.Core             │
│  Native/Win32.cs              │
│  - P/Invoke: DeleteFile, etc. │
│  - Operaciones nativas reales │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  TechToolkit.Core             │
│  Logging/StructuredLogger.cs   │
│  - Registra operación         │
│  - Resultado + métricas       │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  TechToolkit.UI              │
│  - Actualiza progreso visual  │
│  - Muestra resultado al user  │
└──────────────────────────────┘
```

### Flujo 3: AutopilotEngine (Modo One-Click con IA)

```
Usuario hace clic en "Optimizar TODO" (One-Click)
        │
        ▼
┌──────────────────────────────┐
│  AutopilotEngine.cs           │
│  - Lee estado del sistema     │
│  - Evalúa qué módulos ejecutar │
│  - Prioriza según necesidad   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  ExecutionEngine (Core)       │
│  - Ejecuta módulos en orden   │
│  - Maneja errores             │
│  - Genera reporte             │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  TechToolkit.UI              │
│  - Dashboard con resultados   │
│  - Score antes/después        │
└──────────────────────────────┘
```

---

## 🧠 Estrategia de Integración de IA

| Componente | Ubicación | Propósito | Se distribuye con la app? |
|---|---|---|---|
| 33 IA Skills | `.trae/skills/`, `/.skills/` | Automatizan el desarrollo del proyecto | ❌ No (solo dev) |
| Planner/Executor/Critic | `ai-dev-assistant-v4-clean/apps/api/agents/` | Agentes autónomos de desarrollo | ❌ No (solo dev) |
| AI Module | `TechToolkit.Infrastructure/AI/` | Posible asistente de diagnóstico en la app | ⚠️ Depende de la decisión |

**Recomendación**: Los agentes de desarrollo se quedan internos. El módulo de Infrastructure/AI podría usarse para:
- Análisis inteligente de sistema (ej: "tu disco está al 90%, te recomiendo X")
- Asistente de solución integrada ("¿quiero que repare los problemas encontrados?")

---

## 🔌 Puntos de Integración entre Componentes

| Origen | Destino | Método | Qué se comunica |
|---|---|---|---|
| App Desktop → API | Licencia | HTTP REST | HWID, clave, validación |
| Web Panel → API | Datos | HTTP REST | Licencias, métricas, analytics |
| App Desktop → OpenRouter | IA | HTTP REST | Análisis de sistema (si se habilita) |
| Dev Agents → Repo Código | Desarrollo | API/CLI | Sugerencias, PRs, código |

**Nota importante**: La app desktop y los agentes de IA **NO se comunican directamente**. Son componentes independientes que comparten el mismo repositorio por conveniencia.

---

## 📊 Métricas del Proyecto Actual

| Métrica | Valor |
|---|---|
| Proyectos .NET | 9 |
| Módulos nativos | 27 |
| Pruebas unitarias | 46 |
| IA Skills | 33 |
| Pantallas WPF | 6 |
| Temas visuales | 3 |
| Líneas de código | Estimado: 15,000-30,000 |

---

*Este documento es la fuente de verdad arquitectónica del proyecto. Actualizar cuando se tomen nuevas decisiones.*
