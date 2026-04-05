# FASE 5: SEGURIDAD Y PRODUCCIÓN

## 📋 Checklist de Seguridad para SaaS

---

## 1. Autenticación JWT + OAuth2

### JWT Configuration

```csharp
// TechToolkit.Api/Program.cs — Auth Setup
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

var jwtConfig = builder.Configuration.GetSection("Jwt");
var secret = jwtConfig["Secret"] ?? throw new InvalidOperationException("JWT secret not configured");
var issuer = jwtConfig["Issuer"] ?? "techtoolkit";
var audience = jwtConfig["Audience"] ?? "techtoolkit";

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = issuer,
        ValidAudience = audience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
        ClockSkew = TimeSpan.Zero // No clock tolerance — más estricto
    };

    // Para la app desktop que usa API Keys
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            // Soportar API Keys en query string para el sync del desktop
            var apiKey = context.Request.Query["api_key"];
            if (!string.IsNullOrEmpty(apiKey))
            {
                context.Token = apiKey;
            }
            return Task.CompletedTask;
        }
    };
});

// API Key authentication scheme (para desktop sync)
builder.Services.AddAuthentication("ApiKey")
    .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>("ApiKey", null);
```

### JWT Token Generation

```csharp
// TechToolkit.Api.Infrastructure/Auth/JwtProvider.cs
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace TechToolkit.Api.Infrastructure.Auth;

public record JwtTokens(string AccessToken, string RefreshToken, DateTimeOffset ExpiresAt);

public class JwtProvider
{
    private readonly string _secret;
    private readonly string _issuer;
    private readonly string _audience;
    private readonly TimeSpan _accessTokenLifetime;
    private readonly TimeSpan _refreshTokenLifetime;

    public JwtProvider(IConfiguration config)
    {
        var jwt = config.GetSection("Jwt");
        _secret = jwt["Secret"]!;
        _issuer = jwt["Issuer"]!;
        _audience = jwt["Audience"]!;
        _accessTokenLifetime = TimeSpan.FromMinutes(jwt.GetValue<int>("AccessTokenLifetimeMinutes", 30));
        _refreshTokenLifetime = TimeSpan.FromDays(jwt.GetValue<int>("RefreshTokenLifetimeDays", 30));
    }

    public JwtTokens GenerateTokens(Guid userId, string email, string role, string? deviceId = null)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Email, email),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(ClaimTypes.Role, role),
        };

        if (!string.IsNullOrEmpty(deviceId))
        {
            claims.Add(new Claim("device_id", deviceId));
        }

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var accessToken = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims: claims,
            expires: DateTime.UtcNow + _accessTokenLifetime,
            signingCredentials: creds
        );

        var tokenString = new JwtSecurityTokenHandler().WriteToken(accessToken);

        // Refresh token: bytes aleatorios seguros (no JWT)
        var refreshTokenBytes = new byte[64];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(refreshTokenBytes);
        var refreshToken = Convert.ToBase64String(refreshTokenBytes);

        return new JwtTokens(
            AccessToken: tokenString,
            RefreshToken: refreshToken,
            ExpiresAt: DateTimeOffset.UtcNow + _accessTokenLifetime
        );
    }

    // Generar API Key para dispositivos (más larga, no expira pronto)
    public string GenerateApiKey()
    {
        var bytes = new byte[32];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(bytes);
        return "tk_" + Convert.ToBase64String(bytes).Replace("+", "-").Replace("/", "_").Replace("=", "");
    }
}
```

### API Key Authentication Handler

```csharp
// TechToolkit.Api.Infrastructure/Auth/ApiKeyAuthenticationHandler.cs
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace TechToolkit.Api.Infrastructure.Auth;

public class ApiKeyAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    private readonly IApiKeyStore _apiKeyStore;

    public ApiKeyAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        IApiKeyStore apiKeyStore)
        : base(options, logger, encoder)
    {
        _apiKeyStore = apiKeyStore;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // Buscar API key en header o query
        string? apiKey = Request.Headers["X-API-Key"].FirstOrDefault()
            ?? Request.Query["api_key"].FirstOrDefault();

        if (string.IsNullOrEmpty(apiKey))
            return AuthenticateResult.NoResult();

        var device = await _apiKeyStore.ValidateAsync(apiKey);
        if (device == null)
            return AuthenticateResult.Fail("Invalid API key");

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, device.UserId.ToString()),
            new Claim("device_id", device.Id.ToString()),
            new Claim("auth_method", "api_key"),
            new Claim(ClaimTypes.Role, "device"),
        };

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);

        return AuthenticateResult.Success(ticket);
    }
}
```

---

## 2. Password Hashing — Argon2id

```csharp
// TechToolkit.Api.Infrastructure/Security/PasswordHasher.cs
using Konscious.Security.Cryptography; // paquete Konscious.Security.Cryptography.Argon2
using System.Security.Cryptography;

namespace TechToolkit.Api.Infrastructure.Security;

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string password, string hash);
}

public class Argon2PasswordHasher : IPasswordHasher
{
    // Argon2id: resistente a GPU y ASIC attacks
    private const int MemorySizeKB = 65536;  // 64 MB
    private const int Iterations = 3;
    private const int DegreeOfParallelism = 4;
    private const int SaltSize = 16;
    private const int HashSize = 32;

    public string Hash(string password)
    {
        var salt = new byte[SaltSize];
        RandomNumberGenerator.Fill(salt);

        using var argon2 = new Argon2id(Encoding.UTF8.GetBytes(password))
        {
            Salt = salt,
            MemorySize = MemorySizeKB,
            DegreeOfParallelism = DegreeOfParallelism,
            Iterations = Iterations,
        };

        var hash = argon2.GetBytes(HashSize);

        // Format: $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
        return $"$argon2id$v=19$m={MemorySizeKB},t={Iterations},p={DegreeOfParallelism}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public bool Verify(string password, string hash)
    {
        try
        {
            // Parsear el hash
            var parts = hash.Split('$');
            var config = parts[3].Split(',');
            var memorySize = int.Parse(config[0].Split('=')[1]);
            var iterations = int.Parse(config[1].Split('=')[1]);
            var parallelism = int.Parse(config[2].Split('=')[1]);
            var salt = Convert.FromBase64String(parts[4]);
            var expectedHash = Convert.FromBase64String(parts[5]);

            using var argon2 = new Argon2id(Encoding.UTF8.GetBytes(password))
            {
                Salt = salt,
                MemorySize = memorySize,
                Iterations = iterations,
                DegreeOfParallelism = parallelism,
            };

            var computedHash = argon2.GetBytes(HashSize);
            return CryptographicOperations.FixedTimeEquals(computedHash, expectedHash);
        }
        catch
        {
            return false;
        }
    }
}
```

---

## 3. Secrets Management

### Nunca hardcodear secretos

```yaml
# docker-compose.yml — Variables de entorno
services:
  api:
    environment:
      - ASPNETCORE_ENVIRONMENT=Production
      - JWT_SECRET=${JWT_SECRET}
      - JWT_ISSUER=techtoolkit
      - DB_HOST=${DB_HOST}
      - DB_NAME=techtoolkit
      - DB_USER=${DB_USER}
      - DB_PASSWORD=${DB_PASSWORD}
      - REDIS_HOST=redis
      - REDIS_PASSWORD=${REDIS_PASSWORD}
      - SMTP_HOST=${SMTP_HOST}
      - SMTP_USER=${SMTP_USER}
      - SMTP_PASSWORD=${SMTP_PASSWORD}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - S3_ENDPOINT=${S3_ENDPOINT}
      - S3_ACCESS_KEY=${S3_ACCESS_KEY}
      - S3_SECRET_KEY=${S3_SECRET_KEY}
      - S3_BUCKET=techtoolkit-reports

    # En producción, usar Docker secrets o Vault
    secrets:
      - jwt_secret
      - db_password
      - smtp_password
```

### .env.example (comprometido al repo):

```bash
# JWT
JWT_SECRET=your-256-bit-secret-key-here-use-hex-or-random

# Database
DB_HOST=localhost
DB_NAME=techtoolkit
DB_USER=techtoolkit
DB_PASSWORD=change-me

# Redis
REDIS_PASSWORD=change-me

# Email
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASSWORD=change-me

# OpenRouter (para módulos de IA)
OPENROUTER_API_KEY=sk-or-v1-...

# S3 (para reportes)
S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=techtoolkit-reports
```

---

## 4. Rate Limiting Avanzado

### Para endpoints críticos

```csharp
// Rate limiting por tipo de endpoint
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, ct) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        await context.HttpContext.Response.WriteAsJsonAsync(new
        {
            error = "rate_limit_exceeded",
            message = "Demasiadas solicitudes. Espera un momento.",
            retry_after_seconds = 60
        }, cancellationToken: ct);
    };

    // Login: 5 intentos cada 15 min (anti brute force)
    options.AddPolicy("login", http =>
        http.WithFixedWindowLimiter(new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(15),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));

    // Register: 3 intentos cada hora
    options.AddPolicy("register", http =>
        http.WithFixedWindowLimiter(new FixedWindowRateLimiterOptions
        {
            PermitLimit = 3,
            Window = TimeSpan.FromHours(1),
            QueueLimit = 0,
        }));

    // API normal: 1000 req/hora por usuario
    options.AddPolicy("api", http =>
        http.RequireAuthorization()
            .WithFixedWindowLimiter(new FixedWindowRateLimiterOptions
            {
                PermitLimit = 1000,
                Window = TimeSpan.FromHours(1),
                QueueLimit = 10,
            }));

    // Sync desktop: 60/min por dispositivo
    options.AddPolicy("sync", http =>
        http.RequireAuthorization()
            .WithSlidingWindowLimiter(new SlidingWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1),
                SegmentsPerWindow = 6,
                QueueLimit = 5,
            }));

    // Public: 20 req/5 min
    options.AddPolicy("public", http =>
        http.WithFixedWindowLimiter(new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(5),
        }));
});
```

---

## 5. CORS + Security Headers

```csharp
// Program.cs
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(
        policy =>
        {
            policy.WithOrigins(allowedOrigins ?? Array.Empty<string>())
                  .AllowAnyMethod()
                  .AllowAnyHeader()
                  .AllowCredentials()
                  .WithExposedHeaders("X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining");
        });
});

// Security Headers Middleware
app.Use(async (context, next) =>
{
    context.Response.Headers.ContentSecurityPolicy = "default-src 'self'; img-src 'self' data: https:; script-src 'self'";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers.XFrameOptions = "DENY";
    context.Response.Headers.XXssProtection = "0"; // CSP handles XSS
    context.Response.Headers.ReferrerPolicy = "strict-origin-when-cross-origin";
    context.Response.Headers.PermissionsPolicy = "camera=(), microphone=(), geolocation=()";
    context.Response.Headers.StrictTransportSecurity = "max-age=31536000; includeSubDomains; preload";
    await next();
});
```

---

## 6. Audit Logging

### Toda acción sensible se registra

```csharp
// TechToolkit.Api.Infrastructure/Audit/AuditLogger.cs
public record AuditEntry(
    Guid UserId,
    string Action,
    string Resource,
    Guid? ResourceId,
    string? IpAddress,
    string? UserAgent,
    DateTimeOffset Timestamp,
    Dictionary<string, object>? Details = null
);

public class AuditLogger : IAuditLogger
{
    private readonly IDbContext _db;
    private readonly ILogger<AuditLogger> _logger;

    public AuditLogger(IDbContext db, ILogger<AuditLogger> logger)
    {
        _db = db;
        _logger = logger;
    }

    public Task LogAsync(AuditEntry entry)
    {
        _logger.Information(
            "AUDIT: {Action} on {Resource} by user {UserId} from {IpAddress}",
            entry.Action, entry.Resource, entry.UserId, entry.IpAddress);

        // Guardar en DB (async fire-and-forget)
        return _db.AuditLogs.AddAsync(new AuditLogEntity
        {
            UserId = entry.UserId,
            Action = entry.Action,
            Resource = entry.Resource,
            ResourceId = entry.ResourceId,
            IpAddress = entry.IpAddress,
            UserAgent = entry.UserAgent,
            Details = entry.Details,
            CreatedAt = entry.Timestamp
        });
    }

    // Acciones comunes
    public Task LoginAsync(Guid userId, string ip, string userAgent) =>
        LogAsync(new AuditEntry(userId, "auth.login", "user", userId, ip, userAgent));

    public Task LicenseActivatedAsync(Guid userId, Guid licenseId, string deviceId, string ip) =>
        LogAsync(new AuditEntry(userId, "license.activate", "license", licenseId, ip, null,
            new Dictionary<string, object> { { "device_id", deviceId } }));

    public Task SyncUploadAsync(Guid userId, Guid deviceId, string type, int recordCount) =>
        LogAsync(new AuditEntry(userId, "sync.upload", "sync", deviceId, null, null,
            new Dictionary<string, object> { { "type", type }, { "records", recordCount } }));

    public Task SettingsChangedAsync(Guid userId, string setting, string oldValue, string newValue) =>
        LogAsync(new AuditEntry(userId, "settings.change", "user", userId, null, null,
            new Dictionary<string, object> { { "setting", setting }, { "old", oldValue }, { "new", newValue } }));
}
```

---

## 7. Docker Composición

### Desarrollo

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: techtoolkit
      POSTGRES_USER: techtoolkit
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - DB_HOST=postgres
      - REDIS_HOST=redis
      - JWT_SECRET=dev-secret-change-me-in-production
    ports:
      - "5000:8080"
    depends_on:
      - postgres
      - redis

  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:5000
    ports:
      - "3000:3000"
    depends_on:
      - api

volumes:
  pgdata:
  redisdata:
```

### Producción

```yaml
# docker-compose.prod.yml
services:
  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    deploy:
      resources:
        limits:
          memory: 2G
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U techtoolkit"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD} --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      retries: 3

  api:
    image: ghcr.io/<org>/techtoolkit-api:latest
    restart: always
    environment:
      - ASPNETCORE_ENVIRONMENT=Production
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 1G
          cpus: "1.0"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      retries: 3

  web:
    image: ghcr.io/<org>/techtoolkit-web:latest
    restart: always
    environment:
      - NEXT_PUBLIC_API_URL=${API_URL}
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 512M
          cpus: "0.5"

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./infra/nginx/default.conf:/etc/nginx/conf.d/default.conf
      - ./certs:/etc/letsencrypt
    depends_on:
      - api
      - web

  prometheus:
    image: prom/prometheus:latest
    restart: always
    volumes:
      - ./infra/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    restart: always
    volumes:
      - grafana-data:/var/lib/grafana
    ports:
      - "3001:3000"
    depends_on:
      - prometheus

  loki:
    image: grafana/loki:latest
    restart: always
    volumes:
      - loki-data:/loki
    ports:
      - "3100:3100"

volumes:
  pgdata:
  redisdata:
  prometheus-data:
  grafana-data:
  loki-data:
```

---

## 8. API Dockerfile

```dockerfile
# apps/api/Dockerfile — Multi-stage build optimizado
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
WORKDIR /src

# Copiar solo los archivos de proyecto primero (mejor caching de Docker)
COPY TechToolkit.API.Domain/TechToolkit.API.Domain.csproj ./TechToolkit.API.Domain/
COPY TechToolkit.API.Infrastructure/TechToolkit.API.Infrastructure.csproj ./TechToolkit.API.Infrastructure/
COPY TechToolkit.API/TechToolkit.API.csproj ./TechToolkit.API/

# Restaurar dependencias
RUN dotnet restore ./TechToolkit.API/TechToolkit.API.csproj

# Copiar el resto del código
COPY . .

# Build
RUN dotnet publish ./TechToolkit.API/TechToolkit.API.csproj \
    -c Release \
    -o /app/publish \
    --no-restore

# Runtime image — mínimo
FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS runtime
WORKDIR /app

# Non-root user por seguridad
RUN addgroup -g 1000 -S appgroup && \
    adduser -u 1000 -S appuser -G appgroup

# Copiar published output
COPY --from=build /app/publish .

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:8080/health || exit 1

USER appuser
EXPOSE 8080

ENTRYPOINT ["dotnet", "TechToolkit.API.dll"]
```

---

## 9. CI/CD Pipeline

```yaml
# .github/workflows/ci-api.yml
name: CI — API

on:
  push:
    branches: [main, develop]
    paths:
      - "apps/api/**"
  pull_request:
    paths:
      - "apps/api/**"

jobs:
  build:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: testdb
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: "8.0.x"

      - name: Restore
        run: dotnet restore apps/api/TechToolkit.API.sln

      - name: Build
        run: dotnet build apps/api/TechToolkit.API.sln --no-restore -c Release

      - name: Test
        run: dotnet test apps/api/TechToolkit.API.sln --no-build -c Release --logger trx --results-directory test-results

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: api-test-results
          path: test-results/

      - name: CodeQL Security Scan
        uses: github/codeql-action/analyze@v3
        with:
          languages: csharp
          build-mode: none

  docker:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: ./apps/api
          push: true
          tags: ghcr.io/${{ github.repository }}/api:latest,ghcr.io/${{ github.repository }}/api:${{ github.sha }}
```

---

## 10. Production Checklist

### Antes de lanzar a producción

| # | Check | Estado |
|---|---|---|
| 1 | `JWT_SECRET` cambiado (no el default) | ☐ |
| 2 | `DB_PASSWORD` fuerte (20+ chars) | ☐ |
| 3 | SSL configurado (Let's Encrypt) | ☐ |
| 4 | Firewall activo (solo puertos 80, 443) | ☐ |
| 5 | Backup automático de PostgreSQL (diario) | ☐ |
| 6 | Health checks funcionando | ☐ |
| 7 | Log aggregation activo (Loki) | ☐ |
| 8 | Alertas configuradas (Grafana) | ☐ |
| 9 | Rate limiting activo | ☐ |
| 10 | CORS origin restricción | ☐ |
| 11 | Security headers verificados | ☐ |
| 12 | API documentation (Swagger) deshabilitada en producción | ☐ |
| 13 | Error pages personalizdas | ☐ |
| 14 | Terms of Service + Privacy Policy en el web | ☐ |
| 15 | GDPR compliance (data export + delete) | ☐ |

---

*Seguridad y producción lista. Fase 6 viene con el plan de migración y resultado final.*
