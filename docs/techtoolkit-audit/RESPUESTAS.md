# RESPUESTAS — Preguntas Clave de TechToolkit PRO

---

## 1️⃣ ¿La API (Node.js/Fastify) es para licencias o para IA?

**Para licencias principalmente.** La API en `ai-dev-assistant-v4-clean/apps/api/` actúa como el **servidor de licencias** que la app de escritorio consulta para validar claves de activación. Es el componente que verifica HWID, claves, expiración y permisos PRO.

Podría evolucionar para incluir más endpoints (analytics, métricas de uso, sincronización de diagnósticos en la nube), pero su rol actual es la gestión de licencias.

**¿Por qué está dentro de la carpeta `ai-dev-assistant`?** Probablemente porque se creó como parte del ecosistema de IA para desarrollo y se compartió la infraestructura. Es una conveniencia de estructura, no una relación funcional.

---

## 2️⃣ ¿El web (Next.js) es un panel de administración o una versión SaaS?

**Probablemente ambos, en fases:**

| Fase | Propósito | Estado |
|---|---|---|
| **Ahora** | Landing page + blog + documentación del producto | ✅ Existe (CSS/JS/blog/fonts) |
| **Fase 2** | Panel de administración de licencias para el desarrollador | ⏳ Posible |
| **Fase 3** | Versión SaaS: monitoreo remoto de PCs desde la web | 🔮 Future |

La estructura actual (`css/`, `js/`, `blog/`, `data/`, `modules/`, `fonts/`, `assets/`) sugiere que es principalmente un sitio de marketing y documentación, con la infraestructura lista para evolucionar a algo más.

---

## 3️⃣ ¿La carpeta `dev/` (ai-dev-assistant) y `TechToolkit.*` están integradas o son separadas?

**Son separadas funcionalmente. Comparten repositorio por conveniencia.**

- La app **NO** llama a los agentes de IA en tiempo de ejecución
- Los agentes **NO** modifican el código de la app automáticamente (al menos no por ahora)
- No hay comunicación HTTP entre ellos

**¿Por qué están en el mismo repositorio?**
- Conviene tener todo el contexto del proyecto disponible para los agentes de IA
- Los 33 skills necesitan acceso al código fuente para funcionar
- Es más fácil mantener la coherencia cuando todo está junto

**Recomendación**: Mantenerlos juntos mientras el equipo sea pequeño. Separar cuando se necesite CI/CD independiente o el repo se vuelva demasiado pesado.

---

## 4️⃣ AutopilotEngine: ¿es el "Modo One-Click" o algo más?

**AutopilotEngine es el motor del "Modo One-Click" con inteligencia adicional.**

No es solo un botón que ejecuta todos los módulos en secuencia. Es un componente que:

1. **Evalúa el estado actual del sistema** (CPU, RAM, disco, seguridad)
2. **Determina qué módulos se necesitan** (no ejecuta todo ciegamente)
3. **Prioriza las acciones** (primero lo que más impacto tiene)
4. **Ejecuta en orden óptimo** (usa el ExecutionEngine de Core)
5. **Genera un reporte antes/después** para mostrar el impacto

**Ejemplo:**
```
Estado: Disco al 95%, temp files = 4.2GB, DNS cache corrupt
Autopilot decide:
  1. CrashDumpsCleaner (libera 1.8GB primero)
  2. TempFilesCleaner (libera 2.4GB)
  3. FlushDNS (repara cache corrupt)
  4. DiskHealth check (verifica que el disco está bien)
Resultado: Score 72 → 94
```

**¿Tiene IA?** Podría. `TechToolkit.Infrastructure/AI/` existe y podría integrarse para que las decisiones del Autopilot sean más inteligentes a lo largo del tiempo (machine learning de patrones de uso del usuario). Pero actualmente, opera con reglas predefinidas basadas en el diagnóstico.

---

## 5️⃣ ¿Por qué Node.js en lugar de una API en .NET?

Probable respuesta: **los agentes de IA ya estaban en Node.js.** Fastify se usó porque el ecosistema de IA (planner, executor, critic) ya tenía dependencias de TypeScript. Crear un wrapper de licencias en el mismo runtime era más práctico que mantener dos stacks de backend.

**¿Debería migrarse a .NET?** No necesariamente. Tener la API de licencias fuera del binario de la app es una buena decisión de seguridad. Node.js funciona bien para APIs REST ligeras. Si el equipo crece y se necesita consistencia de stack, se puede migrar después, pero no es urgente.

---

## 📋 RECOMENDACIÓN DE ESTRATEGIA DE REPOSITORIOS

### Opción A: Monorepo (Recomendado AHORA)

**Mantener todo en un solo repositorio con carpetas claras.**

```
TechToolkit/
├── apps/
│   ├── desktop/          # Todo el código .NET
│   └── web/              # Next.js + Fastify
├── tools/
│   └── ai-dev-assistant/ # Agentes de IA
├── packages/             # Código compartido (si lo hay)
└── docs/
```

**Ventajas:**
- Un solo lugar para Issues, PRs, CI/CD
- Los agentes de IA tienen acceso completo al contexto
- Más fácil para un equipo pequeño

### Opción B: Multirepo (Recomendado CUANDO crezcas)

**Separar en repositorios independientes cuando:**
- Haya más de 2-3 desarrolladores trabajando en paralelo
- El web/API necesite su propio CI/CD y releases independientes
- El repo sea demasiado grande (>500MB sin código fuente)
- Quieras hacer open source solo partes del proyecto

```
├── TechToolkit-Docs      # App WPF (pública/comercial)
├── TechToolkit-Web       # Panel web (+ API de licencias)
├── TechToolkit-AI-Agent  # Agentes de IA (privadointerno)
└── TechToolkit-License   # Servidor de licencias (privado)
```

### Veredicto

**Quédate con el monorepo por ahora.** La estructura ya existe y funciona. Cuando el equipo crezca o necesites releases independientes, separa. No prematures la optimización arquitectónica.

---

## 📝 PRÓXIMOS PASOS RECOMENDADOS

1. **Reorganizar carpetas**: Mover `TechToolkit.*` a `apps/desktop/`, `techtoolkit-web` a `apps/web/`, `ai-dev-assistant-v4-clean` a `tools/ai-dev-assistant/`
2. **Agregar `.sln` raíz**: Asegurar que el archivo de solución .NET exista y referencie todos los proyectos
3. **Crear Dockerfile** para la API de Fastify → despliegue fácil
4. **Documentar el API** con OpenAPI/Swagger → los agentes de IA y el web pueden consumirlo limpiamente
5. **Definir .gitignore** adecuado para cada componente
6. **Configurar CI/CD** con GitHub Actions: build .NET + test + build web

---

*Documento generado el 2026-04-05. Actualizar cuando se tomen decisiones sobre reestructuración.*
