# API Gateway — Documentação Técnica

Gateway HTTP de entrada para o marketplace. Responsável por autenticação, rate limiting, logging, roteamento de requisições para os microserviços internos e resiliência (circuit breaker, retry, timeout, fallback).

---

## Sumário

1. [Estrutura do Projeto](#estrutura-do-projeto)
2. [Arquitetura](#arquitetura)
3. [Bootstrap — `main.ts`](#bootstrap--maints)
4. [Módulo Raiz — `AppModule`](#módulo-raiz--appmodule)
5. [Configuração dos Serviços — `gateway.config.ts`](#configuração-dos-serviços--gatewayconfigts)
6. [Módulo de Proxy — `ProxyModule`](#módulo-de-proxy--proxymodule)
7. [Camada de Resiliência](#camada-de-resiliência)
   - [RetryService](#retryservice)
   - [TimeoutService](#timeoutservice)
   - [CircuitBreakerService](#circuitbreakerservice)
   - [CacheFallbackService](#cachefallbackservice)
   - [DefaultFallbackService](#defaultfallbackservice)
8. [Módulo de Autenticação — `AuthModule`](#módulo-de-autenticação--authmodule)
9. [Guards](#guards)
10. [Decorators](#decorators)
11. [Módulo de Health — `HealthModule`](#módulo-de-health--healthmodule)
12. [Middleware de Logging](#middleware-de-logging)
13. [Rate Limiting](#rate-limiting)
14. [Fluxo Completo de uma Requisição](#fluxo-completo-de-uma-requisição)
15. [Problemas Identificados](#problemas-identificados)
16. [Variáveis de Ambiente](#variáveis-de-ambiente)

---

## Estrutura do Projeto

```
api-gateway/
├── src/
│   ├── main.ts                                   # Bootstrap: Helmet, CORS, Validation, Swagger
│   ├── app.module.ts                             # Módulo raiz (guards globais, middleware, imports)
│   ├── app.controller.ts                         # Endpoint raiz GET /
│   ├── app.service.ts                            # Serviço raiz
│   │
│   ├── config/
│   │   └── gateway.config.ts                    # URLs e timeouts dos microserviços
│   │
│   ├── auth/
│   │   ├── auth.module.ts                        # Módulo de autenticação (JWT, Passport, HttpModule)
│   │   ├── auth.controller.ts                    # POST /auth/login e POST /auth/register
│   │   ├── auth.service.ts                       # login(), register(), validateJwtToken(), validateSessionToken()
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts         # @CurrentUser() — injeta request.user no parâmetro
│   │   │   ├── public.decorator.ts               # @Public() — marca rota como pública
│   │   │   └── roles.decorator.ts                # @Roles() — define papéis exigidos
│   │   ├── dtos/
│   │   │   ├── login.tdo.ts                      # LoginDto: email + password
│   │   │   └── register.dto.ts                   # RegisterDto: email, password, firstName, lastName, role
│   │   └── strategies/
│   │       └── jwt.strategy.ts                   # Passport JWT Strategy
│   │
│   ├── guards/
│   │   ├── auth.guard.ts                         # JWTAuthGuard — valida Bearer token
│   │   ├── role.guard.ts                         # RoleGuard — verifica papel do usuário
│   │   ├── session.guard.ts                      # SessionGuard — valida x-session-token
│   │   └── throttler.guard.ts                    # CustomThrottlerGuard — rate limiting por IP+UA
│   │
│   ├── middleware/
│   │   ├── middleware.module.ts
│   │   └── logging/
│   │       └── logging.middleware.ts             # Log de entrada, saída, erros e timeouts
│   │
│   ├── proxy/
│   │   ├── proxy.module.ts                       # Importa HttpModule + módulos de resiliência
│   │   └── proxy.service.ts                      # Núcleo do gateway: repassa requisições com resiliência
│   │
│   ├── health/
│   │   ├── health.module.ts
│   │   ├── health.controller.ts                  # GET /health, /health/services, /health/ready, /health/live
│   │   └── health.service.ts                     # getHealthStatus(), getReadyStatus(), getLiveStatus()
│   │
│   └── common/
│       ├── circuit-breaker/
│       │   ├── circuit-breaker.module.ts
│       │   ├── circuit-breaker.interface.ts      # Enums e interfaces do circuit breaker
│       │   └── circuit-breaker.service.ts        # Implementação do padrão Circuit Breaker
│       ├── fallback/
│       │   ├── fallback.module.ts
│       │   ├── fallback.interface.ts             # FallbackStrategy e FallbackOptions
│       │   ├── cache.fallback.ts                 # CacheFallbackService — fallback com cache em memória
│       │   └── default.fallback.ts               # DefaultFallbackService — fallback com erro ou valor padrão
│       ├── health/
│       │   ├── health-check.module.ts
│       │   ├── health-check.interface.ts         # HealthStatus enum e ServiceHealth interface
│       │   └── health-check.service.ts           # Verifica saúde de cada microserviço
│       ├── retry/
│       │   ├── retry.module.ts
│       │   ├── retry.interface.ts                # RetryOptions e RetryResult
│       │   └── retry.service.ts                  # Retry com exponential backoff e jitter
│       └── timeout/
│           ├── timeout.module.ts
│           ├── timeout.interface.ts              # TimeoutOptions
│           └── timeout.service.ts               # Timeout com corrida de Promises
```

---

## Arquitetura

```
Cliente HTTP
     │
     ▼
┌────────────────────────────────────────┐
│               main.ts                  │
│  Helmet · CORS · ValidationPipe        │
│  Swagger docs em /api                  │
└────────────────┬───────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────┐
│     LoggingMiddleware (global)         │  ← forRoutes('*')
│  Loga entrada, saída, erro e timeout   │
└────────────────┬───────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────┐
│    CustomThrottlerGuard (APP_GUARD)    │  ← Rate limiting por IP + User-Agent
│  short · medium · long                 │
└────────────────┬───────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌──────────────┐  ┌──────────────────────┐
│ AuthController│  │   HealthController   │
│ POST /login   │  │ GET /health/*        │
│ POST /register│  └──────────────────────┘
└──────┬────────┘
       │
       ▼
┌────────────────────────────────────────┐
│             AuthService                │
│  login() → users-service /login        │
│  register() → users-service /auth/reg. │
│  validateJwtToken() → JwtService       │
│  validateSessionToken() → users-svc    │
└────────────────────────────────────────┘

Fluxo de proxy para qualquer rota de microserviço:

ProxyService.proxyRequest()
     │
     ▼
CircuitBreakerService.executeWithCircuitBreaker()
     │  (se circuit OPEN → fallback)
     ▼
RetryService.executeWithExponentialBackoff()
     │  (até 4 tentativas com exponential backoff + jitter)
     ▼
TimeoutService.executeWithCustomTimeout()
     │  (Promise.race com timeout do serviço)
     ▼
HttpService.request()  →  Microserviço
     │
     ▼ (GET com sucesso)
CacheFallbackService.setCachedData()   ← armazena para fallback futuro
     │
     ▼
response.data
```

---

## Bootstrap — `main.ts`

**Arquivo:** `src/main.ts`

Ponto de entrada da aplicação. Configura as camadas transversais antes de subir o servidor:

### Helmet

Adiciona cabeçalhos de segurança HTTP:

- `Content-Security-Policy`: restringe scripts e estilos apenas à própria origem
- `HSTS`: força HTTPS por 1 ano, incluindo subdomínios e com preload
- `crossOriginEmbedderPolicy`: desabilitado (evita bloqueios em contextos de embed)

### CORS

Validação dinâmica de origin via callback:

- Lê `process.env.CORS_ORIGIN` (suporta múltiplas origins separadas por vírgula)
- Permite requisições sem origin (ex: curl, Postman)
- Métodos: `GET, HEAD, PUT, PATCH, POST, DELETE`
- Headers permitidos incluem `Authorization` e `X-Requested-With`
- `credentials: true` para suporte a cookies
- Cache de preflight: 24 horas (`maxAge`)

### ValidationPipe (global)

- `transform: true` — converte payloads para os tipos dos DTOs
- `whitelist: true` — remove campos não declarados no DTO
- `forbidNonWhitelisted: true` — lança erro se campos extras forem enviados

### Swagger

Documentação automática em `/api`:

- Suporte a `Bearer JWT` e `x-session-token` (API Key)
- Tags: Authentication, Users, Products, Checkout, Payments, Health
- Contato e licença MIT configurados

---

## Módulo Raiz — `AppModule`

**Arquivo:** `src/app.module.ts`

Agrega todos os módulos e configura comportamentos globais:

### Módulos importados

| Módulo                                     | Finalidade                                                |
| ------------------------------------------ | --------------------------------------------------------- |
| `ConfigModule.forRoot({ isGlobal: true })` | Torna variáveis de ambiente disponíveis em todo o projeto |
| `ThrottlerModule.forRootAsync(...)`        | Configura as três faixas de rate limiting lidas do `.env` |
| `ProxyModule`                              | Serviço de proxy com toda a camada de resiliência         |
| `MiddlewareModule`                         | Exporta o `LoggingMiddleware`                             |
| `AuthModule`                               | JWT, login, register                                      |
| `HealthModule`                             | Endpoints `/health/*`                                     |
| `HealthCheckModule`                        | `HealthCheckService` — pinga cada microserviço            |
| `FallbackModule`                           | `CacheFallbackService` + `DefaultFallbackService`         |
| `CircuitBreakerModule`                     | `CircuitBreakerService`                                   |
| `TimeoutModule`                            | `TimeoutService`                                          |
| `RetryModule`                              | `RetryService`                                            |

### Guard global

```typescript
{ provide: APP_GUARD, useClass: CustomThrottlerGuard }
```

O `CustomThrottlerGuard` é o único guard ativo globalmente. O `JWTAuthGuard` está definido mas ainda não está registrado como `APP_GUARD`.

### Middleware global

```typescript
consumer.apply(LoggingMiddleware).forRoutes('*');
```

O `LoggingMiddleware` intercepta todas as requisições.

---

## Configuração dos Serviços — `gateway.config.ts`

**Arquivo:** `src/config/gateway.config.ts`

Objeto estático `serviceConfig` que define URL e timeout de cada microserviço:

```typescript
export const serviceConfig = {
  users: {
    url: process.env.USERS_SERVICE_URL || 'http://localhost:3000',
    timeout: 10000,
  },
  products: {
    url: process.env.PRODUCTS_SERVICE_URL || 'http://localhost:3001',
    timeout: 10000,
  },
  checkout: {
    url: process.env.CHECKOUT_SERVICE_URL || 'http://localhost:3003',
    timeout: 10000,
  },
  payments: {
    url: process.env.PAYMENTS_SERVICE_URL || 'http://localhost:3004',
    timeout: 10000,
  },
} as const;
```

O `timeout` de 10 segundos é usado em dois lugares por requisição:

1. No `HttpService.request()` como configuração do Axios
2. No `TimeoutService.executeWithCustomTimeout()` como limite do `Promise.race`

---

## Módulo de Proxy — `ProxyModule`

**Arquivo:** `src/proxy/proxy.module.ts` e `src/proxy/proxy.service.ts`

O `ProxyService` é o núcleo do gateway. Toda requisição destinada a um microserviço passa por ele.

### Dependências injetadas

```typescript
constructor(
  private readonly httpService: HttpService,
  private readonly circuitBreakerService: CircuitBreakerService,
  private readonly cacheFallbackService: CacheFallbackService,
  private readonly defaultFallbackService: DefaultFallbackService,
  private readonly timeoutService: TimeoutService,
  private readonly retryService: RetryService,
) {}
```

### Método principal: `proxyRequest()`

```typescript
async proxyRequest(
  serviceName: keyof typeof serviceConfig,
  method: string,
  path: string,
  data?: unknown,
  headers?: Record<string, string>,
  userInfo?: UserInfo,
)
```

O método executa a requisição em três camadas aninhadas de resiliência:

```
CircuitBreaker
  └── RetryService (máx. 4 tentativas)
        └── TimeoutService (limite = service.timeout = 10s)
              └── HttpService.request()
```

**Propagação de identidade do usuário:**  
Antes de enviar ao microserviço, o `proxyRequest` adiciona os seguintes headers com dados do usuário autenticado:

- `x-user-id` — ID do usuário
- `x-user-email` — Email do usuário
- `x-user-role` — Papel/role do usuário

**Cache automático em GETs:**  
Toda resposta bem-sucedida de requisições `GET` é salva no `CacheFallbackService` com a chave `${serviceName}-${path}`. Essa cache é usada como fallback se o serviço ficar indisponível.

### Fallbacks por serviço

Definidos no método privado `createServiceFallback()`:

| Serviço    | Método             | Fallback                                                          |
| ---------- | ------------------ | ----------------------------------------------------------------- |
| `users`    | `POST /auth/login` | Erro: "Authentication service unavailable"                        |
| `users`    | qualquer outro     | Erro: "User service unavailable"                                  |
| `products` | `GET`              | Cache (default: `{ products: [], total: 0, page: 1, limit: 10 }`) |
| `products` | não-GET            | Erro: "Product service unavailable"                               |
| `checkout` | qualquer           | Erro: "checkout service unavailable"                              |
| `payments` | qualquer           | Erro: "payments service unavailable"                              |
| padrão     | qualquer           | Erro: "Service unavailable"                                       |

O fallback de cache do `products` retorna a última resposta GET armazenada, ou o valor padrão se não houver cache.

---

## Camada de Resiliência

### RetryService

**Arquivo:** `src/common/retry/retry.service.ts`

Implementa retry com **exponential backoff** e **jitter** seguindo a recomendação da [AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/).

#### Interfaces

```typescript
interface RetryOptions {
  maxRetries: number; // Número máximo de retentativas (padrão: 3)
  baseDelay: number; // Atraso inicial em ms (padrão: 1000)
  maxDelay: number; // Atraso máximo em ms (padrão: 30000)
  backoffMultiplier: number; // Multiplicador por tentativa (padrão: 2)
  jitter: boolean; // Adiciona aleatoriedade ao delay (padrão: true)
}

interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number; // Quantas tentativas foram feitas
  totalTime: number; // Tempo total em ms
}
```

#### Cálculo do delay

```
delay = baseDelay * (backoffMultiplier ^ tentativa)
delay = delay * (0.5 + random * 0.5)  // jitter: 50%-100% do valor calculado
delay = min(delay, maxDelay)
```

Exemplo com `baseDelay=1000`, `backoffMultiplier=2`:

- Tentativa 1: ~500ms–1000ms
- Tentativa 2: ~1000ms–2000ms
- Tentativa 3: ~2000ms–4000ms

O jitter evita o **thundering herd problem** — situação em que múltiplos clientes reenviam simultaneamente após uma falha, sobrecarregando o serviço que está tentando se recuperar.

#### Métodos públicos

**`executeWithRetry(operation, options)`**  
Executa a operação respeitando todos os parâmetros de `RetryOptions`. Retorna um `RetryResult<T>` com metadados (`attempts`, `totalTime`, `success`).

**`executeWithExponentialBackoff(operation, maxRetries = 3)`**  
Wrapper simplificado: chama `executeWithRetry` e relança o erro se todas as tentativas falharem. Retorna diretamente o dado. É esse método que o `ProxyService` utiliza (com `maxRetries = 4`).

---

### TimeoutService

**Arquivo:** `src/common/timeout/timeout.service.ts`

Controla o tempo máximo de espera de operações assíncronas usando `Promise.race`.

#### Interface

```typescript
interface TimeoutOptions {
  timeout: number; // Tempo limite em ms (padrão: 5000)
  retries: number; // Número de tentativas (padrão: 3)
  backoffMultiplier: number; // Multiplicador de backoff (padrão: 2)
  maxBackoff: number; // Backoff máximo em ms (padrão: 30000)
}
```

#### Métodos públicos

**`executeWithTimeout(operation, options?)`**  
Executa a operação com retry interno e timeout por tentativa. Combina timeout + retry em um único método.

**`executeWithCustomTimeout(operation, timeoutMs)`**  
Método simples: corre `operation()` contra uma promise que rejeita após `timeoutMs` ms. É esse método que o `ProxyService` usa, passando `service.timeout` (10s) como limite.

```typescript
// Internamente:
return Promise.race([
  operation(),
  new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  ),
]);
```

Se a operação HTTP demorar mais de 10 segundos, a Promise de timeout vence a corrida e o `RetryService` recebe o erro — podendo tentar novamente até esgotar as tentativas.

---

### CircuitBreakerService

**Arquivo:** `src/common/circuit-breaker/circuit-breaker.service.ts`

Implementa o padrão **Circuit Breaker** com três estados:

```
CLOSED ──(failureThreshold atingido)──► OPEN
  ▲                                       │
  │                           (resetTimeout expirado)
  │                                       ▼
  └────────(operação bem-sucedida)── HALF_OPEN
```

#### Estados

| Estado      | Comportamento                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `CLOSED`    | Operação executada normalmente. `failureCount` é incrementado a cada falha.                              |
| `OPEN`      | Operação **bloqueada**. Fallback chamado imediatamente. Aguarda `resetTimeout` para tentar novamente.    |
| `HALF_OPEN` | `resetTimeout` expirou. Permite **uma tentativa**. Se bem-sucedida → CLOSED; se falhar → OPEN novamente. |

#### Interface

```typescript
interface CircuitBreakerOptions {
  failureThreshold: number; // Falhas consecutivas para abrir o circuito
  timeout: number; // Tempo (ms) que o circuito fica em OPEN antes de tentar HALF_OPEN
  resetTimeout: number; // Tempo de espera antes da próxima tentativa em HALF_OPEN
}

interface CircuitBreakerState {
  state: CircuitBreakerStateEnum;
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}
```

#### Configuração usada pelo ProxyService

```typescript
{ failureThreshold: 3, timeout: 30000, resetTimeout: 30000 }
```

- Após **3 falhas consecutivas**, o circuito abre
- Fica aberto por **30 segundos** antes de tentar HALF_OPEN
- Chave do circuito: `proxy-${serviceName}` (ex: `proxy-users`, `proxy-products`)

Cada microserviço tem seu próprio circuito independente. Um outage no `users-service` não interfere no circuito do `products-service`.

#### Métodos auxiliares

```typescript
getCircuitState(key: string): CircuitBreakerState | undefined
getAllCircuits(): Map<string, CircuitBreakerState>
resetCircuit(key: string): void
```

---

### CacheFallbackService

**Arquivo:** `src/common/fallback/cache.fallback.ts`

Cache em memória simples (`Map`) com suporte a TTL (Time-To-Live).

#### Funcionamento

- **Escrita:** `setCachedData(key, data)` — armazena junto com o timestamp atual
- **Leitura:** `getCachedData(key, timeout?)` — retorna `null` se expirado (default: 5 min)
- **Fallback factory:** `createCacheFallback(key, defaultData, timeout?)` — retorna uma função que busca o cache e, se não encontrar, retorna `defaultData`

O `ProxyService` armazena toda resposta GET bem-sucedida automaticamente:

```typescript
if (method.toLowerCase() === 'get') {
  this.cacheFallbackService.setCachedData(
    `${serviceName}-${path}`,
    response.data,
  );
}
```

Quando o circuit breaker abre para `products` em requisições GET, o fallback tenta buscar os dados em cache antes de retornar o valor padrão `{ products: [], total: 0, page: 1, limit: 10 }`.

---

### DefaultFallbackService

**Arquivo:** `src/common/fallback/default.fallback.ts`

Fábrica de funções de fallback para diferentes situações:

| Método                                                | Retorno                                        |
| ----------------------------------------------------- | ---------------------------------------------- |
| `createDefaultFallback(defaultResponse, serviceName)` | Retorna um valor padrão definido pelo chamador |
| `createErrorFallback(serviceName, errorMessage)`      | Lança um `Error` com mensagem descritiva       |
| `createEmptyArrayFallback(serviceName)`               | Retorna `[]`                                   |
| `createEmptyObjectFallback(serviceName)`              | Retorna `{}`                                   |

O `ProxyService` usa `createErrorFallback` para serviços críticos como `users`, `checkout` e `payments` — onde retornar dados vazios seria pior do que informar o erro ao cliente.

---

## Módulo de Autenticação — `AuthModule`

**Arquivo:** `src/auth/auth.module.ts`

### Imports

- `PassportModule` — framework de autenticação
- `HttpModule` — para chamar o microserviço `users`
- `JwtModule.registerAsync(...)` — lê `JWT_SECRET` do `.env`, token expira em `1d`

### AuthService

**Arquivo:** `src/auth/auth.service.ts`

| Método                               | Descrição                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `login(loginDto)`                    | `POST` para `users-service/login`. Retorna `AuthResponse` com `access_token` e dados do usuário.      |
| `register(registerDto)`              | `POST` para `users-service/auth/register`. Retorna `AuthResponse`.                                    |
| `validateJwtToken(token)`            | Usa `JwtService.verify()` para validar o token localmente. Lança `UnauthorizedException` se inválido. |
| `validateSessionToken(sessionToken)` | `GET` para `users-service/session/validate/:token`. Retorna `UserSession` com `{ valid, user }`.      |

### AuthController

**Arquivo:** `src/auth/auth.controller.ts`

| Rota                  | Método       | Throttle            | Body          |
| --------------------- | ------------ | ------------------- | ------------- |
| `POST /auth/login`    | `login()`    | `short: 5 req/60s`  | `LoginDto`    |
| `POST /auth/register` | `register()` | `medium: 3 req/60s` | `RegisterDto` |

### DTOs

**`LoginDto`** (`src/auth/dtos/login.tdo.ts`):

- `email: string` — validado com `@IsEmail()`
- `password: string` — mínimo 6 caracteres (`@MinLength(6)`)

**`RegisterDto`** (`src/auth/dtos/register.dto.ts`):

- `email: string` — `@IsEmail()`
- `password: string` — mínimo 6 caracteres
- `firstName: string` — `@IsString()`
- `lastName: string` — `@IsString()`
- `role?: Role` — opcional, padrão `'user'` (enum: `user | admin | seller`)

### JwtStrategy

**Arquivo:** `src/auth/strategies/jwt.strategy.ts`

Estratégia Passport que:

1. Extrai o token do header `Authorization: Bearer <token>`
2. Valida com a `JWT_SECRET`
3. Chama `authService.validateJwtToken(payload.token)` para validação adicional
4. Define `request.user = { userId, email, role }`

> **Problema:** O `JwtStrategy` **não está registrado** em `AuthModule.providers`. Sem isso, o Passport não carrega a estratégia `jwt` e o `JWTAuthGuard` falha ao tentar autenticar. Ver [Problemas Identificados](#problemas-identificados).

---

## Guards

### `CustomThrottlerGuard` — ATIVO GLOBALMENTE

**Arquivo:** `src/guards/throttler.guard.ts`  
**Status:** Registrado em `app.module.ts` como `APP_GUARD`

Estende o `ThrottlerGuard` do `@nestjs/throttler` com dois comportamentos customizados:

**Tracker por IP + User-Agent:**

```typescript
protected async getTracker(req): Promise<string> {
  return `${req.ip}-${req.headers['user-agent']}`;
}
```

Clientes diferentes no mesmo IP (ex: navegadores distintos) têm contadores separados.

**Headers de resposta:**

- `X-RateLimit-Limit` — limite da faixa
- `X-RateLimit-Remaining` — requisições restantes
- `X-RateLimit-Reset` — segundos até resetar
- `Retry-After` — retornado junto ao `429 Too Many Requests`

---

### `JWTAuthGuard` — DEFINIDO, MAS NÃO APLICADO

**Arquivo:** `src/guards/auth.guard.ts`  
**Status:** Existe no código mas não está em nenhum `APP_GUARD` nem `@UseGuards`

O que faz:

1. Verifica se a rota tem o metadata `isPublic` (definido por `@Public()`)
2. Se sim, passa sem autenticar (`return true`)
3. Se não, aciona a estratégia Passport `jwt`
4. Em `handleRequest()`, lança `UnauthorizedException` se o usuário não for válido

---

### `RoleGuard` — DEFINIDO, MAS NÃO APLICADO

**Arquivo:** `src/guards/role.guard.ts`  
**Status:** Existe no código mas não está registrado em lugar nenhum

O que faz:

1. Lê os papéis exigidos via `@Roles()` (metadata `roles`)
2. Se nenhum papel for exigido, passa (`return true`)
3. Compara `request.user.role` com os papéis permitidos
4. Lança `ForbiddenException` se o papel não bater

**Dependência:** precisa que `request.user` já esteja preenchido pelo `JWTAuthGuard` ou `SessionGuard`.

---

### `SessionGuard` — DEFINIDO, MAS NÃO APLICADO

**Arquivo:** `src/guards/session.guard.ts`  
**Status:** Existe no código mas não está registrado em lugar nenhum

O que faz:

1. Extrai o header `x-session-token`
2. Chama `authService.validateSessionToken(token)` → consulta o `users-service`
3. Se a sessão for válida, define `request.user = session.user`
4. Lança `UnauthorizedException` se não tiver token ou sessão inválida

**Dependência:** Precisa do `AuthService`, que atualmente **não é exportado** pelo `AuthModule`. Ver [Problemas Identificados](#problemas-identificados).

---

## Decorators

### `@Public()`

**Arquivo:** `src/auth/decorators/public.decorator.ts`

```typescript
export const Public = () => SetMetadata('isPublic', true);
```

Marca uma rota como pública. O `JWTAuthGuard` lê esse metadata e permite a passagem sem autenticação.

**Status:** Definido mas não usado em nenhum controller, pois o `JWTAuthGuard` ainda não está ativo.

---

### `@Roles()`

**Arquivo:** `src/auth/decorators/roles.decorator.ts`

```typescript
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
```

Define quais papéis têm acesso à rota. O `RoleGuard` lê esse metadata.

**Status:** Definido mas não usado em nenhum controller.

---

### `@CurrentUser()`

**Arquivo:** `src/auth/decorators/current-user.decorator.ts`

```typescript
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

Decorator de parâmetro que injeta o usuário autenticado (`request.user`) diretamente no argumento do método handler.

**Status:** Implementado corretamente. Pronto para uso assim que o `JWTAuthGuard` ou `SessionGuard` for ativado.

```typescript
// Uso futuro:
@Get('profile')
async getProfile(@CurrentUser() user: UserPayload) {
  return user; // { userId, email, role }
}
```

---

## Módulo de Health — `HealthModule`

**Arquivo:** `src/health/`

Sistema completo de monitoramento de saúde com quatro endpoints:

### Endpoints

| Rota                                | Descrição                                                      |
| ----------------------------------- | -------------------------------------------------------------- |
| `GET /health`                       | Status do próprio gateway (uptime, memória, versão)            |
| `GET /health/services`              | Pinga todos os microserviços e retorna status consolidado      |
| `GET /health/services/:serviceName` | Retorna status em cache de um serviço específico               |
| `GET /health/ready`                 | Readiness probe — `ready` se todos os serviços estão `healthy` |
| `GET /health/live`                  | Liveness probe — sempre retorna `alive` com uptime             |

### Resposta de `GET /health/services`

```json
{
  "overallStatus": "healthy | degraded | unhealthy",
  "timestamp": "...",
  "services": [
    {
      "name": "users",
      "url": "http://localhost:3000",
      "status": "healthy",
      "responseTime": 42,
      "lastCheck": "..."
    }
  ],
  "summary": {
    "total": 4,
    "healthy": 3,
    "unhealthy": 1,
    "degraded": 0
  }
}
```

**Status consolidado:**

- `healthy` — todos os serviços estão saudáveis
- `degraded` — ao menos um serviço está saudável e ao menos um não
- `unhealthy` — nenhum serviço responde

### HealthCheckService

**Arquivo:** `src/common/health/health-check.service.ts`

- Faz `GET /{serviceUrl}/health` com timeout configurado por serviço
- Usa `CircuitBreakerService` para os health checks também (evita flood em serviço caído)
- Cache interno: `healthCache: Map<string, ServiceHealth>` — acessível via `getCachedHealth()`
- `checkAllServices()` usa `Promise.allSettled()` para checar os 4 serviços em paralelo

**Estados de saúde:**

```typescript
enum HealthStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  DEGRADED = 'degraded',
}
```

---

## Middleware de Logging

**Arquivo:** `src/middleware/logging/logging.middleware.ts`

Intercepta todas as requisições HTTP e gera três tipos de log:

| Evento               | Nível   | Conteúdo                                               |
| -------------------- | ------- | ------------------------------------------------------ |
| Entrada              | `log`   | `METHOD URL - IP - User-Agent`                         |
| Saída                | `log`   | `METHOD URL - statusCode - contentLength - durationMs` |
| Erro (status >= 400) | `error` | `METHOD URL - statusCode - durationMs`                 |
| Timeout              | `warn`  | `METHOD URL - durationMs`                              |

O duration é calculado desde a entrada da requisição até o evento `finish` do response.

---

## Rate Limiting

Configurado com três faixas independentes, cada uma com TTL e limite próprios. Os limites são lidos de variáveis de ambiente com fallback para valores padrão.

| Nome     | TTL         | Limite padrão | Variável de ambiente |
| -------- | ----------- | ------------- | -------------------- |
| `short`  | 1 segundo   | 10 req        | `RATE_LIMIT_SHORT`   |
| `medium` | 60 segundos | 100 req       | `RATE_LIMIT_MEDIUM`  |
| `long`   | 15 minutos  | 1000 req      | `RATE_LIMIT_LONG`    |

**Limites específicos por rota:**

| Rota                  | Faixa                   | Limite           |
| --------------------- | ----------------------- | ---------------- |
| `POST /auth/login`    | `short`                 | 5 req/60s        |
| `POST /auth/register` | `medium`                | 3 req/60s        |
| Todas as demais       | `short + medium + long` | Padrão do `.env` |

O rastreamento é feito por **IP + User-Agent** (`${req.ip}-${req.headers['user-agent']}`).

---

## Fluxo Completo de uma Requisição

### Exemplo: `GET /products/123` (usuário autenticado via JWT)

```
1. Cliente envia: GET /products/123
                  Authorization: Bearer eyJ...

2. LoggingMiddleware
   → loga: "Incoming Request: GET /products/123 - IP: x.x.x.x"

3. CustomThrottlerGuard
   → verifica limites short/medium/long para IP+UA
   → adiciona X-RateLimit-* nos headers de resposta

4. (Futuro) JWTAuthGuard
   → verifica se rota é @Public() → não é
   → aciona JwtStrategy → extrai Bearer token
   → chama authService.validateJwtToken()
   → define request.user = { userId, email, role }

5. (Futuro) RoleGuard
   → verifica se @Roles() está na rota → não está → passa

6. Controller (ainda não implementado para proxy direto)
   → chama ProxyService.proxyRequest('products', 'GET', '/123', ...)

7. ProxyService
   → cria fallback: cacheFallback para 'products-/123'
   → CircuitBreakerService: circuit 'proxy-products' está CLOSED → executa

8. RetryService.executeWithExponentialBackoff(operation, 4)
   → Tentativa 1:

9. TimeoutService.executeWithCustomTimeout(operation, 10000)
   → Promise.race([httpRequest, timeoutPromise(10000)])

10. HttpService.request({ method: 'get', url: 'http://localhost:3001/123', ... })
    → headers enriquecidos: x-user-id, x-user-email, x-user-role

11. (Sucesso)
    → CacheFallbackService.setCachedData('products-/123', response.data)
    → RetryService: "Operation succeeded on attempt 1"
    → CircuitBreakerService: onSuccess() → failureCount = 0, state = CLOSED

12. LoggingMiddleware
    → loga: "Outgoing Response: GET /products/123 - 200 - 342b - 87ms"
```

### Exemplo: `GET /products/123` (serviço indisponível)

```
7-10. HttpService falha → timeout após 10s

11. TimeoutService rejeita → RetryService captura
    → aguarda ~500ms-1000ms (jitter)
    → Tentativa 2 → falha
    → aguarda ~1000ms-2000ms
    → Tentativa 3 → falha
    → aguarda ~2000ms-4000ms
    → Tentativa 4 → falha

12. RetryService relança o erro
    CircuitBreakerService.onFailure(): failureCount = 1

    (se já era a 3ª falha consecutiva):
    → circuit state = OPEN
    → nextAttemptTime = now + 30s

13. CircuitBreakerService chama fallback:
    → CacheFallbackService busca 'products-/123'
    → se encontrar em cache (< 5 min): retorna dados cacheados
    → se não: retorna { products: [], total: 0, page: 1, limit: 10 }
```

---

## Problemas Identificados

### 1. `JwtStrategy` não registrado no `AuthModule`

**Arquivo:** `src/auth/auth.module.ts`

```typescript
// Como está:
providers: [AuthService],

// Como deveria ser:
providers: [AuthService, JwtStrategy],
```

Sem isso, o Passport não carrega a estratégia `jwt` e o `JWTAuthGuard` vai falhar ao tentar autenticar.

---

### 2. `JWTAuthGuard` não aplicado em nenhum lugar

O guard existe mas nenhuma rota está protegida. Todas as rotas (além do rate limiting) estão abertas.

**Como ativar globalmente (recomendado):**

`src/app.module.ts`:

```typescript
providers: [
  AppService,
  { provide: APP_GUARD, useClass: CustomThrottlerGuard },
  { provide: APP_GUARD, useClass: JWTAuthGuard }, // ← adicionar
],
```

E marcar as rotas públicas com `@Public()`:

```typescript
// auth.controller.ts
@Public()
@Post('login')
async login() { ... }

@Public()
@Post('register')
async register() { ... }

// health.controller.ts
@Public()
@Get()
async getHealth() { ... }
```

---

### 3. `AuthService` não exportado pelo `AuthModule`

**Arquivo:** `src/auth/auth.module.ts`

```typescript
// Como está:
exports: [],

// Como deveria ser (para o SessionGuard funcionar):
exports: [AuthService],
```

O `SessionGuard` depende do `AuthService`. Como não está exportado, registrar o guard em outro módulo causa erro de injeção de dependência.

---

### 4. `RoleGuard` e `SessionGuard` sem nenhuma referência

Estão definidos mas sem nenhum uso em módulos, controllers ou como `APP_GUARD`. Precisam ser ativados manualmente por rota ou globalmente após resolver os problemas 1, 2 e 3.

---

## Variáveis de Ambiente

| Variável               | Padrão                  | Descrição                                  |
| ---------------------- | ----------------------- | ------------------------------------------ |
| `PORT`                 | `3005`                  | Porta do gateway                           |
| `JWT_SECRET`           | —                       | Segredo para assinar/verificar JWTs        |
| `CORS_ORIGIN`          | `*`                     | Origins permitidas (separadas por vírgula) |
| `USERS_SERVICE_URL`    | `http://localhost:3000` | URL do microserviço de usuários            |
| `PRODUCTS_SERVICE_URL` | `http://localhost:3001` | URL do microserviço de produtos            |
| `CHECKOUT_SERVICE_URL` | `http://localhost:3003` | URL do microserviço de checkout            |
| `PAYMENTS_SERVICE_URL` | `http://localhost:3004` | URL do microserviço de pagamentos          |
| `RATE_LIMIT_SHORT`     | `10`                    | Limite do throttle `short` (por 1s)        |
| `RATE_LIMIT_MEDIUM`    | `100`                   | Limite do throttle `medium` (por 60s)      |
| `RATE_LIMIT_LONG`      | `1000`                  | Limite do throttle `long` (por 15min)      |
