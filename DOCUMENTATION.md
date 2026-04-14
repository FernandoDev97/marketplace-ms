# API Gateway — Documentação Técnica

Gateway HTTP de entrada para o marketplace. Responsável por autenticação, rate limiting, logging e roteamento de requisições para os microserviços internos.

---

## Sumário

1. [Estrutura do Projeto](#estrutura-do-projeto)
2. [Arquitetura](#arquitetura)
3. [Guards — Análise Completa](#guards--análise-completa)
4. [Decorators — Análise Completa](#decorators--análise-completa)
5. [Fluxo de Autenticação](#fluxo-de-autenticação)
6. [Problemas Identificados](#problemas-identificados)
7. [Onde Aplicar Guards e Decorators](#onde-aplicar-guards-e-decorators)
8. [Módulos e Responsabilidades](#módulos-e-responsabilidades)
9. [Variáveis de Ambiente](#variáveis-de-ambiente)
10. [Rate Limiting](#rate-limiting)

---

## Estrutura do Projeto

```
api-gateway/
├── src/
│   ├── main.ts                          # Bootstrap da aplicação
│   ├── app.module.ts                    # Módulo raiz (configurações globais)
│   ├── app.controller.ts                # Endpoint raiz e /health
│   ├── app.service.ts                   # Serviço raiz
│   │
│   ├── auth/
│   │   ├── auth.module.ts               # Módulo de autenticação
│   │   ├── auth.controller.ts           # Rotas POST /auth/login e /auth/register
│   │   ├── auth.service.ts              # Lógica de validação JWT e sessão
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts  # @CurrentUser
│   │   │   ├── public.decorator.ts        # @Public
│   │   │   └── roles.decorator.ts         # @Roles
│   │   └── strategies/
│   │       └── jwt.strategy.ts            # Estratégia Passport JWT
│   │
│   ├── guards/
│   │   ├── auth.guard.ts                # JWTAuthGuard — valida Bearer token
│   │   ├── role.guard.ts                # RoleGuard — verifica papel do usuário
│   │   ├── session.guard.ts             # SessionGuard — valida x-session-token
│   │   └── throttler.guard.ts           # CustomThrottlerGuard — rate limiting
│   │
│   ├── middleware/
│   │   └── logging/
│   │       └── logging.middleware.ts    # Log de todas as requisições
│   │
│   ├── proxy/
│   │   ├── proxy.module.ts
│   │   └── proxy.service.ts            # Repassa requisições para os microserviços
│   │
│   └── config/
│       └── gateway.config.ts           # URLs e timeouts dos microserviços
```

---

## Arquitetura

```
Cliente HTTP
     │
     ▼
┌─────────────────────────────┐
│         main.ts             │
│  Helmet · CORS · Validation │
│  Swagger docs em /api       │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  LoggingMiddleware (global) │  ← app.module.ts: forRoutes('*')
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  CustomThrottlerGuard       │  ← app.module.ts: APP_GUARD (global)
│  Rate limiting por IP+UA    │
└─────────────┬───────────────┘
              │
      ┌───────┴────────┐
      ▼                ▼
┌──────────┐    ┌────────────────┐
│   Auth   │    │  AppController │
│Controller│    │ GET / e /health│
└──────────┘    └────────────────┘
      │
      ▼
┌─────────────────────────────┐
│       AuthService           │
│  login() · register()       │
│  validateJwtToken()         │
│  validateSessionToken()     │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│       ProxyService          │
│  Encaminha para os serviços │
│  users · products           │
│  checkout · payments        │
└─────────────────────────────┘
```

---

## Guards — Análise Completa

### `CustomThrottlerGuard` — ATIVO

**Arquivo:** `src/guards/throttler.guard.ts`
**Status:** Aplicado globalmente via `APP_GUARD` em `app.module.ts`

Controla o número de requisições por IP + User-Agent. Define o cabeçalho `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset` nas respostas.

**Onde está aplicado:**
- `app.module.ts` linha 46: `{ provide: APP_GUARD, useClass: CustomThrottlerGuard }` → **todas as rotas**
- `auth.controller.ts` linha 19: `@Throttle({ short: { limit: 5, ttl: 60000 } })` → POST `/auth/login`
- `auth.controller.ts` linha 32: `@Throttle({ medium: { limit: 3, ttl: 60000 } })` → POST `/auth/register`

---

### `JWTAuthGuard` — DEFINIDO, MAS NÃO APLICADO

**Arquivo:** `src/guards/auth.guard.ts`
**Status:** Existe no código mas não está registrado nem usado em nenhum lugar.

O que ele faz:
- Verifica se a rota tem o decorator `@Public()` — se sim, deixa passar sem autenticar.
- Caso contrário, aciona a estratégia Passport `jwt` para validar o Bearer token no cabeçalho `Authorization`.

**Onde deveria ser aplicado:** Ver seção [Onde Aplicar Guards e Decorators](#onde-aplicar-guards-e-decorators).

> **Dependência:** Para funcionar, o `JwtStrategy` precisa ser registrado em `AuthModule.providers` (atualmente está faltando — ver [Problemas Identificados](#problemas-identificados)).

---

### `RoleGuard` — DEFINIDO, MAS NÃO APLICADO

**Arquivo:** `src/guards/role.guard.ts`
**Status:** Existe no código mas não está registrado nem usado em nenhum lugar.

O que ele faz:
- Lê os papéis (`roles`) definidos via `@Roles()` na rota ou controller.
- Compara com `request.user.role` (preenchido pelo `JWTAuthGuard` ou `SessionGuard`).
- Lança `ForbiddenException` se o papel não bater.

**Dependência:** Só funciona **depois** do `JWTAuthGuard` ou `SessionGuard`, porque precisa que `request.user` já esteja preenchido.

**Onde deveria ser aplicado:** Ver seção [Onde Aplicar Guards e Decorators](#onde-aplicar-guards-e-decorators).

---

### `SessionGuard` — DEFINIDO, MAS NÃO APLICADO

**Arquivo:** `src/guards/session.guard.ts`
**Status:** Existe no código mas não está registrado nem usado em nenhum lugar.

O que ele faz:
- Extrai o header `x-session-token` da requisição.
- Chama `AuthService.validateSessionToken()` que consulta o microserviço `users`.
- Define `request.user` com os dados da sessão retornados.

É uma alternativa ao JWT para clientes que usam sessão em vez de token Bearer.

**Onde deveria ser aplicado:** Ver seção [Onde Aplicar Guards e Decorators](#onde-aplicar-guards-e-decorators).

---

## Decorators — Análise Completa

### `@Public()` — DEFINIDO, MAS NÃO USADO

**Arquivo:** `src/auth/decorators/public.decorator.ts`

```typescript
export const Public = () => SetMetadata('isPublic', true);
```

Marca uma rota como pública, permitindo que o `JWTAuthGuard` deixe a requisição passar sem autenticar.

**Status atual:** Não está sendo usado em nenhum controller porque o `JWTAuthGuard` também não está ativo.

**Onde usar quando o guard for ativado:**
```typescript
// Exemplo: rota de login não precisa de autenticação
@Public()
@Post('login')
async login() { ... }
```

---

### `@Roles()` — DEFINIDO, MAS NÃO USADO

**Arquivo:** `src/auth/decorators/roles.decorator.ts`

```typescript
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
```

Define quais papéis podem acessar uma rota ou controller. Trabalha em conjunto com o `RoleGuard`.

**Status atual:** Não está sendo usado em nenhum lugar.

**Onde usar quando o `RoleGuard` for ativado:**
```typescript
// Exemplo: apenas admins podem acessar
@Roles('admin')
@Get('admin/dashboard')
async adminDashboard() { ... }
```

---

### `@CurrentUser()` — DEFINIDO, MAS NÃO USADO (E COM BUG)

**Arquivo:** `src/auth/decorators/current-user.decorator.ts`

É um decorator de parâmetro que deveria injetar o usuário autenticado diretamente no argumento do método.

**Bug atual no código:**
```typescript
// Como está (errado):
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    request.user = data;  // ← Atribui `data` (undefined) ao request.user
                          //   e não retorna nada
  },
);

// Como deveria ser:
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;  // ← Retorna o usuário já preenchido pelo guard
  },
);
```

**Status atual:** Não está sendo usado em nenhum controller. Quando for usado, o bug precisa ser corrigido primeiro.

**Como usar após a correção:**
```typescript
@Get('profile')
async getProfile(@CurrentUser() user: UserPayload) {
  return user; // { userId, email, role }
}
```

---

## Fluxo de Autenticação

O projeto tem infraestrutura para **dois mecanismos de autenticação**, mas nenhum está ativo:

### Mecanismo 1 — JWT (Bearer Token)

```
1. Cliente envia: Authorization: Bearer <token>
2. JWTAuthGuard verifica se a rota tem @Public()
3. Se não for pública → aciona JwtStrategy
4. JwtStrategy valida o token e chama authService.validateJwtToken()
5. request.user = { userId, email, role }
6. RoleGuard verifica se user.role está em @Roles(...)
7. @CurrentUser() injeta request.user no parâmetro do handler
```

### Mecanismo 2 — Session Token

```
1. Cliente envia: x-session-token: <token>
2. SessionGuard extrai o header
3. Chama authService.validateSessionToken() → consulta microserviço users
4. request.user = dados da sessão
5. RoleGuard verifica roles se necessário
```

---

## Problemas Identificados

### 1. `JwtStrategy` não registrado no `AuthModule`

**Arquivo:** `src/auth/auth.module.ts` linha 22

```typescript
// Como está:
providers: [AuthService],

// Como deveria ser:
providers: [AuthService, JwtStrategy],
```

Sem isso, o Passport não carrega a estratégia `jwt` e o `JWTAuthGuard` vai falhar ao tentar autenticar.

---

### 2. `JWTAuthGuard` não está aplicado em nenhum lugar

O guard existe mas nenhuma rota está protegida por ele. Todas as rotas (exceto rate limiting) estão abertas.

---

### 3. `RoleGuard` e `SessionGuard` completamente orfãos

Definidos mas sem nenhuma referência em módulos, controllers ou como `APP_GUARD`.

---

### 4. Bug no `@CurrentUser` decorator

O decorator sobrescreve `request.user` com `undefined` em vez de retornar o usuário. Ver detalhe na seção [Decorators](#decorators--análise-completa).

---

### 5. `AuthService` não exportado pelo `AuthModule`

```typescript
// Como está:
exports: [],

// Como deveria ser (para o SessionGuard poder usar):
exports: [AuthService],
```

O `SessionGuard` depende do `AuthService`, mas como não está exportado, ao registrar o guard em outro módulo ocorreria erro de injeção de dependência.

---

## Onde Aplicar Guards e Decorators

### Opção A — Proteção Global com Exceções Públicas (recomendado para API Gateway)

Registrar o `JWTAuthGuard` globalmente em `app.module.ts` como segundo `APP_GUARD`, e usar `@Public()` nas rotas que não precisam de autenticação:

**`src/app.module.ts`:**
```typescript
providers: [
  AppService,
  { provide: APP_GUARD, useClass: CustomThrottlerGuard },
  { provide: APP_GUARD, useClass: JWTAuthGuard },   // ← adicionar
],
```

**`src/auth/auth.controller.ts`:**
```typescript
@Public()   // ← login e register não precisam de JWT
@Post('login')
async login() { ... }

@Public()
@Post('register')
async register() { ... }
```

**`src/app.controller.ts`:**
```typescript
@Public()   // ← /health também é pública
@Get('health')
async health() { ... }
```

---

### Opção B — Proteção por Rota

Aplicar `@UseGuards` individualmente em cada rota ou controller que precise de proteção:

```typescript
import { UseGuards } from '@nestjs/common';
import { JWTAuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';

@UseGuards(JWTAuthGuard, RoleGuard)
@Roles('admin')
@Get('admin/users')
async listUsers(@CurrentUser() user) { ... }
```

---

### Onde o `SessionGuard` faz sentido

O `SessionGuard` é uma alternativa ao JWT. Pode ser aplicado em rotas que aceitam sessão em vez de token:

```typescript
@UseGuards(SessionGuard)
@Get('profile')
async getProfile(@CurrentUser() user) { ... }
```

Ou combinar os dois (JWT **ou** sessão):

```typescript
// Guard customizado que tenta JWT e, se falhar, tenta sessão
// Ou aplicar ambos em sequência dependendo da estratégia
```

---

### Onde o `RoleGuard` deve ir

Sempre **após** o `JWTAuthGuard` ou `SessionGuard` (porque precisa de `request.user`):

```typescript
// Global: os dois APP_GUARDs são executados em ordem de registro
{ provide: APP_GUARD, useClass: JWTAuthGuard },
{ provide: APP_GUARD, useClass: RoleGuard },

// Por rota: ordem importa
@UseGuards(JWTAuthGuard, RoleGuard)
@Roles('admin', 'moderator')
@Delete('products/:id')
async deleteProduct() { ... }
```

---

## Módulos e Responsabilidades

| Módulo | Arquivo | Responsabilidade |
|--------|---------|------------------|
| `AppModule` | `app.module.ts` | Configuração global: rate limiting, logging, env |
| `AuthModule` | `auth/auth.module.ts` | JWT, login, register, validação de tokens |
| `ProxyModule` | `proxy/proxy.module.ts` | Repasse de requisições para microserviços |
| `MiddlewareModule` | `middleware/middleware.module.ts` | Logging de requisições |

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3005` | Porta do gateway |
| `JWT_SECRET` | — | Segredo para assinar/verificar JWTs |
| `CORS_ORIGIN` | `*` | Origin permitida pelo CORS |
| `USERS_SERVICE_URL` | `http://localhost:3000` | URL do microserviço de usuários |
| `PRODUCTS_SERVICE_URL` | `http://localhost:3001` | URL do microserviço de produtos |
| `CHECKOUT_SERVICE_URL` | `http://localhost:3003` | URL do microserviço de checkout |
| `PAYMENTS_SERVICE_URL` | `http://localhost:3004` | URL do microserviço de pagamentos |
| `RATE_LIMIT_SHORT` | `10` | Limite do throttle `short` (por 1s) |
| `RATE_LIMIT_MEDIUM` | `100` | Limite do throttle `medium` (por 60s) |
| `RATE_LIMIT_LONG` | `1000` | Limite do throttle `long` (por 15min) |

---

## Rate Limiting

Configurado em três faixas, controladas pelo `CustomThrottlerGuard`:

| Nome | TTL | Limite padrão | Aplicação atual |
|------|-----|---------------|-----------------|
| `short` | 1 segundo | 10 req | Global + `POST /auth/login` (5 req/60s) |
| `medium` | 60 segundos | 100 req | Global + `POST /auth/register` (3 req/60s) |
| `long` | 15 minutos | 1000 req | Global |

O rastreamento é feito por **IP + User-Agent**, não apenas por IP.

Cabeçalhos retornados em cada resposta:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
