# Common areas: readable reservations and recovery

**Goal:** Replace internal identifiers with the area's name and make reservation decisions easier to understand.

**Observed failure:** The deployed `/api/common-areas?buildingId=bld_001` returns HTTP 500. The old `areaName` resolver fell back to `areaId`, exposing UUIDs while still allowing approval. The response contains only a controlled generic database error; a missing migration is a hypothesis, not yet a verified diagnosis. CLI access initially belonged to a different Vercel team; the owner identified `helberjfs-projects` for the API.

**Design:** Keep navy and emerald branding. Add summary cards, white reservation cards with a date tile, clear times, unit labels, notes and compact status badges. Never show an internal ID as a name, including during delayed loading or a failed request. An unidentified booking cannot be approved or rejected. Preserve capability checks, query-string tabs, events and area configuration. Provide explicit retry feedback and prevent duplicate decisions.

**Implementation:** Extract `AreaReservationCard` into the existing building components folder, update `Areas.tsx`, and add an isolated Playwright configuration plus API fixtures. Exercise Codegen's recorder with synthetic local data and retain generated actions as test evidence. No real reservations are changed during testing.

**Validation:** Reproduce the failed area query in the authenticated browser, verify the regression test fails on the old UI, then test failed/slow area loading, recovery, decision errors and duplication, permissions, keyboard tabs, responsive layout and accessibility. Inspect desktop/mobile screenshots. Check frontend types, production build and the shared UI suite. Review the code and publish only this change to main, as requested for the ongoing work.

**Frontend evidence:** Eight Playwright cases pass, including actual Codegen recorder output attached as `codegen-areas.json`, failed/slow lookup recovery, shared duplicate protection during delayed refresh, permissions, desktop/mobile accessibility and horizontal overflow. The frontend typecheck, production build and 130 UI tests pass. Screenshots at 1440px and 390px were inspected. Read-only review reports no remaining important findings. The API's production HTTP 500 is being investigated independently; this UI change does not claim to repair the database.
