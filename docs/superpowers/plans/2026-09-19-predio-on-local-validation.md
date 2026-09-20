# Prédio ON Local Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir as declarações de ambiente dos três frontends e a dependência direta da API para que o monorepo passe no typecheck e possa ser aberto localmente.

**Architecture:** Preservar a estrutura atual do monorepo. Cada frontend receberá a declaração padrão do Vite dentro de `src`; a API declarará diretamente o `drizzle-orm` que importa em suas rotas. A validação será feita por TypeScript em cada workspace e por build dos quatro serviços executáveis.

**Tech Stack:** pnpm workspace, TypeScript, Vite, React, Express, Drizzle ORM, PowerShell.

---

### Task 1: Corrigir tipagem dos frontends

**Files:**
- Create: `apps/admin-web/src/vite-env.d.ts`
- Create: `apps/building-web/src/vite-env.d.ts`
- Create: `apps/resident-web/src/vite-env.d.ts`

- [x] **Step 1: Add the Vite ambient declaration to each frontend**

Each file contains exactly:

```ts
/// <reference types="vite/client" />
```

- [x] **Step 2: Run the three frontend typechecks**

Run from each frontend directory:

```powershell
& .\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exit code `0` for `admin-web`, `building-web`, and `resident-web`.

### Task 2: Declare the API's direct Drizzle dependency

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml` through the package manager

- [x] **Step 1: Add `drizzle-orm` to `apps/api/package.json` dependencies**

Use the same compatible range already used by `packages/db`:

```json
"drizzle-orm": "^0.44.0"
```

- [x] **Step 2: Refresh workspace links and lockfile**

Run:

```powershell
pnpm --config.manage-package-manager-versions=false install
```

Expected: exit code `0` and `apps/api/node_modules/drizzle-orm` exists.

- [x] **Step 3: Run API typecheck**

Run from `apps/api`:

```powershell
& .\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exit code `0`.

### Task 3: Validate the complete application

**Files:**
- No source changes.

- [x] **Step 1: Typecheck `db`, `shared`, and `ingest`**

Run the same local `tsc.CMD --noEmit` command from each workspace and expect exit code `0`.

- [x] **Step 2: Build the API and ingest service**

Run from each service directory:

```powershell
& .\node_modules\.bin\tsc.CMD -p tsconfig.build.json
```

Expected: exit code `0`.

- [x] **Step 3: Build all three Vite frontends**

Run from each frontend directory:

```powershell
& .\node_modules\.bin\tsc.CMD -b
& .\node_modules\.bin\vite.CMD build
```

Expected: exit code `0` and a generated `dist` directory in each frontend.

### Task 4: Open the running services

**Files:**
- No source changes.

- [x] **Step 1: Start API and frontends in parallel**

Run from the project root:

```powershell
pnpm --config.manage-package-manager-versions=false --parallel --filter @predioon/api --filter @predioon/admin-web --filter @predioon/building-web --filter @predioon/resident-web dev
```

- [x] **Step 2: Verify the API health endpoint**

Open `http://localhost:3000/health` and expect JSON containing `"ok": true`.

- [x] **Step 3: Open the three Vite applications**

Open:

```text
http://localhost:5173
http://localhost:5174
http://localhost:5175
```

Expected: each application renders its dashboard shell. Database-backed pages may show an API/database warning until Docker infrastructure is started with `pnpm setup:local`.
