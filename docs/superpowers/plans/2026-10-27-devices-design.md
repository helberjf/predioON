# Devices page design and implementation plan

**Goal:** Improve the building equipment page while preserving the navy and emerald Prédio ON identity and existing API contracts.

**Design:** Keep the Dispositivos heading, add context, four summary cards (total, online, requiring attention, disabled), searchable equipment inventory, type and status filters, Portuguese status labels and category icons. Use a roomy table on desktop and equipment cards on narrow screens. Keep explicit loading, error/retry, empty inventory and empty search states. Do not infer a live connection from a timestamp: display the backend status alongside the last reading. Disabled devices take precedence over any reported status. Allow sidebar labels to wrap.

**Architecture:** All inventory controls operate on the existing complete `/devices?buildingId=…` response. Keep presentation helpers local to building-web and reuse `deviceTypeLabel`, resource loading and formatters. Preserve auth and route capability checks. Work on an isolated checkout of the current origin/main, preserving all unrelated local changes. The user explicitly requested publication to main after verification.

**Tech Stack:** React 19, TypeScript, Tailwind, lucide-react, Playwright.

## Tasks

- [x] Add an isolated Playwright configuration and API-boundary fixtures, then verify the new search/filter test fails against the original page.
- [x] Implement the inventory presentation, search, filters, counters, refresh and responsive states in `apps/building-web/src/pages/Devices.tsx`, with local helpers in `apps/building-web/src/components/device-presentation.ts`.
- [x] Make the minimum sidebar label adjustment in `packages/ui/src/components/dashboard-frame.tsx`.
- [x] Run the isolated browser suite (summary accuracy, composed filters, disabled precedence, refresh, loading, empty/error recovery, responsive layout and accessibility), building-web typecheck and production build. Inspect desktop and mobile screenshots, then review the final diff.

## Verification

`pnpm test:e2e:devices` builds and starts only the building frontend on port 5294 and intercepts API requests to a dedicated loopback API on port 3194; no database or production credentials are required. The separate `e2e/isolated` folder keeps these fixtures outside the database-backed feature suite.

`pnpm --filter @predioon/building-web typecheck` and `pnpm --filter @predioon/building-web build` validate integration with the existing workspace.

Verified: nine browser cases, 130 shared UI tests, building frontend typecheck and production build, and architecture boundaries. Desktop (1600px) and mobile (390px) screenshots were inspected. The browser checks include axe accessibility assertions. Code review identified the existing ERROR status; its Portuguese label, filter and disabled precedence are covered by a regression test. The final contrast adjustment passes the accessibility checks. Existing build warnings about bundle size and dependency annotations remain.
