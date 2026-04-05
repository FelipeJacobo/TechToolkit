# FASE 3: MEJORAS CONCRETAS — Código y Implementación

## 1. Sistema de Logging Profesional

### Reemplazar el logger actual por Serilog con sinks múltiples

```csharp
// TechToolkit.Core/Logging/LoggerFactory.cs
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Serilog.Sinks.SystemConsole.Themes;

namespace TechToolkit.Core.Logging;

public static class LoggerFactory
{
    private static Logger? _logger;
    private static readonly object _lock = new();

    public static void Initialize(bool isDevelopment, string? apiEndpoint = null)
    {
        lock (_lock)
        {
            if (_logger != null) return;

            var config = new LoggerConfiguration()
                .MinimumLevel.Debug()
                .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
                .MinimumLevel.Override("System", LogEventLevel.Warning)
                .Enrich.FromLogContext()
                .Enrich.WithProperty("Application", "TechToolkit")
                .Enrich.WithProperty("Version", typeof(LoggerFactory).Assembly.GetName().Version?.ToString());

            if (isDevelopment)
            {
                config.WriteTo.Console(
                    outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {SourceContext}: {Message:lj}{NewLine}{Exception}",
                    theme: SystemConsoleTheme.Colored);
                config.WriteTo.File(
                    "logs/techtoolkit-.log",
                    rollingInterval: RollingInterval.Day,
                    retainedFileCountLimit: 30,
                    outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff} [{Level:u3}] {SourceContext}: {Message:lj}{NewLine}{Exception}");
            }
            else
            {
                // Producción: solo File + HTTP (envía a la API del SaaS)
                config.WriteTo.File(
                    "logs/techtoolkit-.log",
                    rollingInterval: RollingInterval.Day,
                    retainedFileCountLimit: 90,
                    fileSizeLimitBytes: 50_000_000,
                    rollOnFileSizeLimit: true);

                if (!string.IsNullOrEmpty(apiEndpoint))
                {
                    // Sink HTTP personalizado envía logs al servidor SaaS
                    config.WriteTo.Http(apiEndpoint + "/api/v1/logs/ingest");
                }
            }

            _logger = config.CreateLogger();
            Log.Logger = _logger;
        }
    }

    public static Serilog.ILogger Get() => _logger ?? throw new InvalidOperationException("Logger not initialized");
    public static async Task FlushAsync() => await (Log.Logger as ILogger)?.DisposeAsync();
}
```

### Uso en módulos:

```csharp
// Todos los módulos usan ILogger inyectado via DI
public class TempFilesCleaner : IModule
{
    private readonly ILogger _logger;

    public TempFilesCleaner(ILogger logger) => _logger = logger.ForContext<TempFilesCleaner>();

    public async Task<ModuleResult> ExecuteAsync(CancellationToken ct)
    {
        using var activity = _logger.BeginModuleActivity("TempFilesCleaner");
        _logger.Information("Scanning temp directories for cleanup");

        var tempPaths = GetTempPaths();
        _logger.Debug("Found {TempPathCount} temp directories", tempPaths.Length);

        long totalCleaned = 0;
        foreach (var path in tempPaths)
        {
            try
            {
                var cleaned = await CleanDirectoryAsync(path, ct);
                totalCleaned += cleaned;
                _logger.Debug("Cleaned {Bytes} bytes from {Path}", cleaned, path);
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.Warning(ex, "Access denied to {Path}, skipping", path);
                totalCleaned += 0; // continua al siguiente
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Failed to clean {Path}", path);
                // no aborta — el módulo es resiliente
            }
        }

        _logger.Information("Cleanup complete: {TotalBytes} bytes freed", totalCleaned);
        return ModuleResult.Success(totalCleaned);
    }
}
```

---

## 2. Manejo de Errores Global

### Middleware de errores estandarizado

```csharp
// TechToolkit.Core/Errors/ErrorHandlingMiddleware.cs
using System.Net;
using System.Text.Json;

namespace TechToolkit.Core.Errors;

public record ErrorResponse(
    string Code,
    string Message,
    string? Detail = null,
    string? RequestId = null,
    DateTimeOffset? Timestamp = null
)
{
    public static ErrorResponse From(Exception ex, string? requestId = null) => ex switch
    {
        ValidationException ve => new("VALIDATION_ERROR", ve.Message, ve.Errors?.ToString(), requestId, DateTimeOffset.UtcNow),
        UnauthorizedAccessException => new("UNAUTHORIZED", "Acceso denegado. Verifica permisos de administrador.", null, requestId, DateTimeOffset.UtcNow),
        TimeoutException => new("TIMEOUT", "La operación excedió el tiempo límite. Intenta nuevamente.", null, requestId, DateTimeOffset.UtcNow),
        _ => new("INTERNAL_ERROR", "Ocurrió un error interno. Si persiste, contacta soporte.", null, requestId, DateTimeOffset.UtcNow)
    };
}

public class ErrorHandlingMiddleware : IMiddleware
{
    private readonly ILogger<ErrorHandlingMiddleware> _logger;
    private readonly IHostEnvironment _env;

    public ErrorHandlingMiddleware(ILogger<ErrorHandlingMiddleware> logger, IHostEnvironment env)
    {
        _logger = logger;
        _env = env;
    }

    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        try
        {
            await next(context);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception: {Message}", ex.Message);
            await HandleExceptionAsync(context, ex);
        }
    }

    private Task HandleExceptionAsync(HttpContext context, Exception ex)
    {
        var statusCode = ex switch
        {
            ValidationException => (int)HttpStatusCode.BadRequest,
            UnauthorizedAccessException => (int)HttpStatusCode.Unauthorized,
            KeyNotFoundException => (int)HttpStatusCode.NotFound,
            _ => (int)HttpStatusCode.InternalServerError
        };

        var response = ErrorResponse.From(ex, context.TraceIdentifier);
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json";

        var json = JsonSerializer.Serialize(response, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        });

        return context.Response.WriteAsync(json);
    }
}
```

### En Program.cs:

```csharp
app.UseMiddleware<ErrorHandlingMiddleware>();
```

---

## 3. Refactor de AutopilotEngine

### Versión mejorada con evaluación inteligente

```csharp
// TechToolkit.Application/Services/AutopilotEngine.cs
using TechToolkit.Core.Logging;
using TechToolkit.Application.Modules;

namespace TechToolkit.Application.Services;

public class AutoPilotOptimization
{
    public required string ModuleName { get; init; }
    public required string Reason { get; init; }
    public required int Priority { get; init; } // 1 = más urgente
    public required long EstimatedImpact { get; init; } // bytes freed / score gain
}

public class AutopilotResult
{
    public int ScoreBefore { get; init; }
    public int ScoreAfter { get; init; }
    public int ModulesExecuted { get; init; }
    public IReadOnlyList<ModuleExecutionReport> Reports { get; init; } = [];
    public TimeSpan Duration { get; init; }
    public IReadOnlyList<string> Errors { get; init; } = [];
}

public class AutopilotEngine
{
    private readonly IModuleRegistry _moduleRegistry;
    private readonly ISystemProfiler _profiler;
    private readonly ILogger<AutopilotEngine> _logger;
    private readonly IModuleExecutor _executor;

    public AutopilotEngine(
        IModuleRegistry moduleRegistry,
        ISystemProfiler profiler,
        ILogger<AutopilotEngine> logger,
        IModuleExecutor executor)
    {
        _moduleRegistry = moduleRegistry;
        _profiler = profiler;
        _logger = logger;
        _executor = executor;
    }

    public async Task<AutopilotResult> ExecuteOneClickAsync(CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        _logger.Information("Autopilot: Starting one-click optimization");

        // 1. Evaluar estado del sistema
        var profile = await _profiler.GetCurrentStateAsync(ct);
        var scoreBefore = CalculateHealthScore(profile);
        _logger.Information("Autopilot: Current health score = {Score}", scoreBefore);

        // 2. Determinar qué módulos ejecutar y en qué orden
        var optimizations = DetermineOptimizations(profile);
        _logger.Information("Autopilot: {Count} optimizations planned", optimizations.Count);

        var reports = new List<ModuleExecutionReport>();
        var errors = new List<string>();

        // 3. Ejecutar en orden de prioridad
        foreach (var opt in optimizations.OrderBy(o => o.Priority))
        {
            if (ct.IsCancellationRequested) break;

            try
            {
                var module = _moduleRegistry.Get(opt.ModuleName);
                if (module == null)
                {
                    _logger.Warning("Module {Module} not found, skipping", opt.ModuleName);
                    continue;
                }

                _logger.Information("[{Priority}/{Total}] {Module}: {Reason}",
                    opt.Priority, optimizations.Count, opt.ModuleName, opt.Reason);

                var report = await _executor.ExecuteAsync(module, ct);
                reports.Add(report);

                _logger.Information("[{Priority}/{Total}] {Module}: {Result}",
                    opt.Priority, optimizations.Count, opt.ModuleName,
                    report.Status.ToString());

                if (report.Status == ExecutionStatus.Error)
                {
                    errors.Add($"{opt.ModuleName}: {report.ErrorMessage}");
                }
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Module {Module} threw exception", opt.ModuleName);
                errors.Add($"{opt.ModuleName}: {ex.Message}");
            }
        }

        // 4. Re-evaluar
        var profileAfter = await _profiler.GetCurrentStateAsync(ct);
        var scoreAfter = CalculateHealthScore(profileAfter);
        sw.Stop();

        _logger.Information("Autopilot: Complete. Score {Before} → {After} in {Duration}",
            scoreBefore, scoreAfter, sw.Elapsed);

        return new AutopilotResult
        {
            ScoreBefore = scoreBefore,
            ScoreAfter = scoreAfter,
            ModulesExecuted = optimizations.Count,
            Reports = reports,
            Duration = sw.Elapsed,
            Errors = errors
        };
    }

    private int CalculateHealthScore(SystemProfile profile)
    {
        int score = 100;

        // Disco: -30 puntos si > 90% lleno, -15 si > 80%
        if (profile.DiskUsagePercent > 90) score -= 30;
        else if (profile.DiskUsagePercent > 80) score -= 15;
        else if (profile.DiskUsagePercent > 70) score -= 5;

        // RAM: -20 puntos si > 90% usado
        if (profile.RamUsagePercent > 90) score -= 20;
        else if (profile.RamUsagePercent > 80) score -= 10;

        // Security: -20 si Defender desactivado
        if (!profile.DefenderEnabled) score -= 20;
        if (!profile.FirewallEnabled) score -= 10;

        // Startup: -1 punto por cada app innecesaria al inicio (max -10)
        score -= Math.Min(profile.UnnecessaryStartupCount, 10);

        // Updates: -10 si no se actualizaron en 30+ días
        if (profile.LastUpdateAgeDays > 30) score -= 10;
        else if (profile.LastUpdateAgeDays > 14) score -= 5;

        // Temp files: -5 si > 1GB de archivos temporales
        if (profile.TempFilesSizeBytes > 1_000_000_000) score -= 5;

        return Math.Max(0, Math.Min(100, score));
    }

    private List<AutoPilotOptimization> DetermineOptimizations(SystemProfile profile)
    {
        var optimizations = new List<AutoPilotOptimization>();

        // Disk space urgente
        if (profile.DiskUsagePercent > 85)
        {
            optimizations.Add(new()
            {
                ModuleName = "CrashDumpsCleaner",
                Reason = $"Disk at {profile.DiskUsagePercent}%, crash dumps占用 {FormatBytes(profile.CrashDumpsSize)}",
                Priority = 1,
                EstimatedImpact = profile.CrashDumpsSize
            });
            optimizations.Add(new()
            {
                ModuleName = "TempFilesCleaner",
                Reason = $"Disk at {profile.DiskUsagePercent}%, temp files占用 {FormatBytes(profile.TempFilesSizeBytes)}",
                Priority = 2,
                EstimatedImpact = profile.TempFilesSizeBytes
            });
            optimizations.Add(new()
            {
                ModuleName = "WindowsUpdateCache",
                Reason = "Cleaning update cache for disk space",
                Priority = 3,
                EstimatedImpact = 500_000_000
            });
        }

        // Security urgente
        if (!profile.DefenderEnabled)
        {
            optimizations.Add(new()
            {
                ModuleName = "DefenderStatus",
                Reason = "Windows Defender is disabled",
                Priority = 1,
                EstimatedImpact = 20 // score points
            });
        }

        if (!profile.FirewallEnabled)
        {
            optimizations.Add(new()
            {
                ModuleName = "FirewallCheck",
                Reason = "Firewall is disabled",
                Priority = 1,
                EstimatedImpact = 10
            });
        }

        // Performance: startup apps
        if (profile.UnnecessaryStartupCount > 5)
        {
            optimizations.Add(new()
            {
                ModuleName = "StartupOptimizer",
                Reason = $"{profile.UnnecessaryStartupCount} unnecessary startup apps",
                Priority = 4,
                EstimatedImpact = 10
            });
        }

        // Updates
        if (profile.LastUpdateAgeDays > 30)
        {
            optimizations.Add(new()
            {
                ModuleName = "WindowsUpdateManager",
                Reason = $"Windows hasn't updated in {profile.LastUpdateAgeDays} days",
                Priority = 5,
                EstimatedImpact = 10
            });
        }

        // Network: DNS cache
        if (profile.DnsCacheSizeMb > 10)
        {
            optimizations.Add(new()
            {
                ModuleName = "FlushDns",
                Reason = $"DNS cache is {profile.DnsCacheSizeMb}MB",
                Priority = 6,
                EstimatedImpact = profile.DnsCacheSizeMb
            });
        }

        // Prefetch
        if (profile.PrefetchCount > 100)
        {
            optimizations.Add(new()
            {
                ModuleName = "PrefetchCleaner",
                Reason = $"{profile.PrefetchCount} prefetch entries",
                Priority = 7,
                EstimatedImpact = profile.PrefetchSizeBytes
            });
        }

        // Siempre ejecutar diagnóstico final
        optimizations.Add(new()
        {
            ModuleName = "SystemRepair",
            Reason = "System integrity check as final step",
            Priority = 10,
            EstimatedImpact = 0
        });

        return optimizations;
    }

    private string FormatBytes(long bytes) =>
        bytes switch
        {
            >= 1_000_000_000 => $"{bytes / 1_000_000_000.0:F1} GB",
            >= 1_000_000 => $"{bytes / 1_000_000.0:F0} MB",
            >= 1_000 => $"{bytes / 1_000.0:F0} KB",
            _ => $"{bytes} bytes"
        };
}
```

---

## 4. Sistema de Caching

### Cache local para operations pesadas

```csharp
// TechToolkit.Core/Caching/ResultCache.cs
using System.Collections.Concurrent;

namespace TechToolkit.Core.Caching;

public class CachedResult<T>
{
    public T Value { get; init; } = default!;
    public DateTimeOffset ExpiresAt { get; init; }
    public bool IsExpired => DateTimeOffset.UtcNow > ExpiresAt;
}

public class ResultCache
{
    private readonly ConcurrentDictionary<string, object> _store = new();
    private readonly ILogger _logger;

    public ResultCache(ILogger logger) => _logger = logger.ForContext<ResultCache>();

    public T GetOrCompute<T>(
        string key,
        Func<CancellationToken, Task<T>> compute,
        TimeSpan ttl,
        CancellationToken ct = default)
    {
        if (_store.TryGetValue(key, out var stored) && stored is CachedResult<T> cached && !cached.IsExpired)
        {
            _logger.Debug("Cache HIT: {Key}", key);
            return cached.Value;
        }

        _logger.Debug("Cache MISS: {Key}, computing...", key);
        var result = compute(ct).GetAwaiter().GetResult();
        _store[key] = new CachedResult<T>
        {
            Value = result,
            ExpiresAt = DateTimeOffset.UtcNow + ttl
        };
        return result;
    }

    public async Task<T> GetOrComputeAsync<T>(
        string key,
        Func<CancellationToken, Task<T>> compute,
        TimeSpan ttl,
        CancellationToken ct = default)
    {
        if (_store.TryGetValue(key, out var stored) && stored is CachedResult<T> cached && !cached.IsExpired)
        {
            _logger.Debug("Cache HIT: {Key}", key);
            return cached.Value;
        }

        _logger.Debug("Cache MISS: {Key}, computing...", key);
        var result = await compute(ct);
        _store[key] = new CachedResult<T>
        {
            Value = result,
            ExpiresAt = DateTimeOffset.UtcNow + ttl
        };
        return result;
    }

    public void Invalidate(string key) => _store.TryRemove(key, out _);
    public int Count => _store.Count;

    // Limpieza periódica de expirados
    public void Compact()
    {
        foreach (var kvp in _store)
        {
            var cached = kvp.Value;
            var type = cached.GetType();
            var expiresAtProp = type.GetProperty("ExpiresAt");
            if (expiresAtProp?.GetValue(cached) is DateTimeOffset expires && DateTime.UtcNow > expires)
            {
                _store.TryRemove(kvp.Key, out _);
            }
        }
    }
}
```

---

## 5. Estructura de Carpetas Final

```
TechToolkit/
│
├── apps/
│   ├── desktop/                    # App WPF (antes la raíz de TechToolkit.*)
│   │   ├── TechToolkit.Domain/
│   │   ├── TechToolkit.Application/
│   │   ├── TechToolkit.Core/
│   │   ├── TechToolkit.Infrastructure/
│   │   ├── TechToolkit.UI/
│   │   ├── TechToolkit.Tests/
│   │   ├── TechToolkit.Desktop.sln
│   │   └── Dockerfile.dev          # Para devs en Mac/Linux (solo IDE)
│   │
│   ├── api/                        # API SaaS (ASP.NET Core 8)
│   │   ├── src/
│   │   │   ├── TechToolkit.Api/
│   │   │   ├── TechToolkit.Api.Domain/
│   │   │   └── TechToolkit.Api.Infrastructure/
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── TechToolkit.Api.sln
│   │
│   └── web/                        # Panel web (Next.js 15)
│       ├── src/
│       ├── public/
│       ├── next.config.ts
│       ├── package.json
│       ├── Dockerfile
│       └── tailwind.config.ts
│
├── packages/                       # Código compartido
│   ├── license-core/               # Lógica de licencias compartida (C# + TS)
│   └── types/                      # Tipos compartidos (TypeScript)
│
├── tools/
│   ├── ai-dev-assistant/           # Agentes de IA (antes ai-dev-assistant-v4-clean)
│   ├── license-generator/          # Generador de licencias (antes LicenseGeneratorConsole)
│   └── db-migrations/              # Migraciones de base de datos
│
├── infra/                          # Infraestructura como código
│   ├── docker-compose.yml          # Desarrollo local
│   ├── docker-compose.prod.yml     # Producción
│   ├── nginx/
│   │   └── default.conf
│   └── prometheus/
│       └── prometheus.yml
│
├── .github/
│   └── workflows/
│       ├── ci-desktop.yml          # Build + test desktop
│       ├── ci-api.yml              # Build + test API
│       ├── ci-web.yml              # Build + lint web
│       ├── release-desktop.yml     # Publicar desktop
│       └── deploy-api.yml          # Deploy API
│
├── docs/                           # Documentación
│   ├── architecture/
│   ├── api/                        # OpenAPI specs
│   └── guides/
│
├── .editorconfig
├── .gitignore
├── .gitattributes
├── CHANGELOG.md
└── README.md
```

---

## 6. Validación de Inputs Estricta

### FluentValidation para la API

```csharp
// TechToolkit.Api.Infrastructure/Validators/
using FluentValidation;

namespace TechToolkit.Api.Infrastructure.Validators;

public record RegisterRequest(string Email, string Password, string? Name);
public record LicenseActivateRequest(string LicenseKey, string Hwid, string DeviceName, string OsVersion, string AppVersion);
public record SyncUploadRequest(Guid DeviceId, string RecordType, JsonElement Payload);

public class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("Email es requerido")
            .EmailAddress().WithMessage("Email inválido")
            .MaximumLength(255);

        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("La contraseña es requerida")
            .MinimumLength(12).WithMessage("Mínimo 12 caracteres")
            .Matches("[A-Z]").WithMessage("Debe contener una mayúscula")
            .Matches("[a-z]").WithMessage("Debe contener una minúscula")
            .Matches("[0-9]").WithMessage("Debe contener un número")
            .Matches("[^a-zA-Z0-9]").WithMessage("Debe contener un carácter especial");

        RuleFor(x => x.Name)
            .MaximumLength(255).When(x => !string.IsNullOrEmpty(x.Name));
    }
}

public class LicenseActivateRequestValidator : AbstractValidator<LicenseActivateRequest>
{
    public LicenseActivateRequestValidator()
    {
        RuleFor(x => x.LicenseKey)
            .NotEmpty()
            .Matches(@"^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$")
            .WithMessage("Formato de licencia inválido (XXXXX-XXXXX-XXXXX-XXXXX)");

        RuleFor(x => x.Hwid)
            .NotEmpty()
            .MaximumLength(128);

        RuleFor(x => x.DeviceName)
            .NotEmpty()
            .MaximumLength(255)
            .Matches(@"^[a-zA-Z0-9\-_]+$")
            .WithMessage("Nombre de dispositivo inválido");
    }
}
```

### Middleware de validación global:

```csharp
// Program.cs
builder.Services.AddValidatorsFromAssemblyContaining<Program>();

app.UseExceptionHandler("/error"); // Usa el ErrorHandlingMiddleware

// Para cada endpoint:
app.MapPost("/api/v1/auth/register", async (
    RegisterRequest request,
    IValidator<RegisterRequest> validator,
    IAuthService auth,
    CancellationToken ct) =>
{
    var result = await validator.ValidateAsync(request, ct);
    if (!result.IsValid)
    {
        return Results.ValidationProblem(result.ToDictionary(), statusCode: 400);
    }
    var user = await auth.RegisterAsync(request, ct);
    return Results.Ok(new { user.Id, user.Email });
});
```

---

## 7. Rate Limiting

```csharp
// Program.cs
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy("login", http =>
        http.RequireAuthentication()
            .WithFixedWindowLimiter(new()
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(15),
                QueueLimit = 0
            }));

    options.AddPolicy("api", http =>
        http.RequireAuthentication()
            .WithFixedWindowLimiter(new()
            {
                PermitLimit = 1000,
                Window = TimeSpan.FromHour(1),
                QueueLimit = 10
            }));

    options.AddPolicy("anonymous", http =>
        http.WithFixedWindowLimiter(new()
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(5),
            QueueLimit = 0
        }));
});

// En cada endpoint:
app.MapPost("/api/v1/auth/login", LoginHandler)
   .RequireRateLimiting("login");

app.MapGroup("/api/v1/sync")
   .RequireRateLimiting("api");

app.MapGet("/health", HealthCheck)
   .RequireRateLimiting("anonymous");
```

---

*Mejoras listas para implementar. La Fase 4 viene con el Frontend moderno.*
