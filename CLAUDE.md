# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run format       # Format with Prettier
npm run format:check # Check formatting without writing
npm run checks       # Run lint + format check + TypeScript type check + tests
npm test             # Run all tests (unit + integration)
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

`npm run checks` is the full quality gate — run it before committing.

## Architecture

Document management platform built on **Next.js 16 App Router** with **Azure** as the backend infrastructure.

### Data Layer
- **Azure Blob Storage** — file storage, organized in hierarchical paths with versioning via naming convention; SAS tokens for secure temporary access (`src/lib/storage.ts`, `src/lib/file-system/`)
- **Azure Table Storage** — one table: `activityLogs` (audit trail only); accessed via `@azure/data-tables` (`src/lib/activity-logger.ts`)
- **Neon PostgreSQL + Prisma** — all relational data
  - Schema: `prisma/schema.prisma`; client generated to `src/generated/prisma/`; singleton at `src/lib/prisma.ts`; driver: `@prisma/adapter-pg`
  - Models: `Tenant`, `User`, `PasswordReset`, `CustomerCompany`, `DocumentTemplate`, `TemplateVersionHistory`, `Assignment`, `CompletionRecord`
  - `User`: nullable `email?` and `passwordHash?` (no-email workers cannot log in); nullable `jobRole?`; nullable `lineManagerId?` self-ref FK → `User.id` (routes notifications to line manager)
  - `DocumentTemplate`: `formSchema Json?` — array of `FormField` (`src/types/form-schema.ts`): `type` is one of `text | textarea | number | checkbox | date | select | file | section`; `select` fields carry `options: string[]`; `file` fields store an `{ blobPath, fileName }` object once uploaded; `section` fields are heading-only (no value, never required, excluded from stored `formData`); `questions Json?` — each question is `{ id, question, options: string[], answer: string }`; `version Int @default(1)` — incremented on each publish; nullable `ownerCompanyId?` — null = tenant-managed (Simon's library); set = created by that `CustomerCompany`'s admin via the self-serve portal (P17), visible only within that company; `category String @default("General")` (`DocumentTemplateCategory`, `src/types/document-template.ts` — `'COSHH' | 'Fire Safety' | 'First Aid' | 'General' | 'Manual Handling' | 'Other' | 'PPE' | 'Risk Assessment'`, also exported as `DOCUMENT_TEMPLATE_CATEGORIES`) — fixed classification used to group `/admin/templates`, editable at any time (create/edit/publish-version, snapshotted into `TemplateVersionHistory` like `title`/`description`); `sourceType String @default("form")` (`'form' | 'upload'`, `src/types/document-template.ts`) — P19 upload-based documents; `uploadMode String?` (`'read-only' | 'fill-and-return'`, upload templates only); `sourceDocBlobPath`/`sourceDocOriginalBlobPath`/`sourceDocFileName` — converted PDF (served/viewed) + retained Word original (for renewal edits) + display filename, all nullable, upload templates only
  - `TemplateVersionHistory`: `templateId` FK, `version Int`, `changeReason String?`, `snapshot Json` (`{title, description, formSchema, questions, sourceType?, uploadMode?, sourceDocBlobPath?, sourceDocOriginalBlobPath?, sourceDocFileName?}` — the P19 fields are optional since pre-P19 history entries predate them), `publishedAt`, `publishedBy String?` (userId) — only ever holds *superseded* versions; the live version's content lives on `DocumentTemplate` itself
  - `Assignment`: nullable `userId` (individual vs company-wide); nullable `dueDate?`; nullable `targetJobRoles Json?` (string array); `templateVersion Int @default(1)` — snapshot at assignment creation; partial unique indexes include `templateVersion`; nullable `lastReminderSentAt DateTime?` — set by the reminders cron each time a reminder is sent for that assignment; `autoEnroll Boolean @default(false)` — company-wide only (forced `false` when `userId` is set); marks an assignment for auto-enrolment (see `enrollMatchingUsersForAssignment`/`enrollUserInMatchingAssignments` below)
  - `CompletionRecord`: `submittedBlobPath`/`submittedOriginalBlobPath`/`submittedFileName` (all `String?`, P19) hold the employee's own filled-in copy for `fill-and-return` upload templates — converted PDF + retained original, mirroring `DocumentTemplate`'s source doc fields; null for form-based templates and read-only upload templates
  - Lib: `src/lib/customer-companies.ts`, `src/lib/document-templates.ts`, `src/lib/template-version-history.ts`, `src/lib/template-version-diff.ts`, `src/lib/assignments.ts`, `src/lib/completion-records.ts`, `src/lib/outstanding-completions.ts`, `src/lib/form-schema-utils.ts` (`isFieldVisible` — shared by client rendering and server validation), `src/lib/form-validation.ts` (`getMissingRequiredFields`/`getVisibleFormData` — server-side required-field and visibility validation per field type), `src/lib/starter-templates.ts` (hardcoded, client-side-only form field presets for common H&S document types), `src/lib/document-conversion.ts` (`convertToPdf` — Word→PDF via the Gotenberg sidecar, P19), `src/lib/document-upload.ts` (`uploadSourceDocument` — PDF stored as-is, Word converted + original retained; used by both `POST /api/admin/templates/upload-document` and the customer-admin equivalent)
  - `AssignmentWithTemplate.template` (`getAssignmentWithTemplate` et al., `src/lib/assignments.ts`) carries `sourceType`/`uploadMode`/`sourceDocBlobPath`/`sourceDocFileName` through from `DocumentTemplate` (P19) — this is how employee-facing routes know a given assignment is an upload-based document; `GET /api/customer/assignments/[id]/document` generates a SAS view URL for `sourceDocBlobPath`, 404s when the template isn't `sourceType: 'upload'`; `POST /api/customer/assignments/[id]/upload-submission` (P19 Phase 5, fill-and-return only) uploads the employee's own filled-in copy via `uploadSourceDocument()` and returns blob paths — `POST /api/customer/assignments/[id]/complete` then requires that `submission` in its body (400s otherwise) and passes it straight to `createCompletionRecord()`'s `submittedBlobPath`/`submittedOriginalBlobPath`/`submittedFileName` params
  - Key functions: `getAssignmentStatusSummary` (completed records + outstanding users + isOverdue); `getAssignmentsForUser` (filters by `targetJobRoles`, deduplicates by highest-version per templateId — individual beats company-wide at same version); `publishNewTemplateVersion` (requires `changeReason`; in one `$transaction`, snapshots the current content into `TemplateVersionHistory` then increments `version` and applies content updates); `createAssignmentsForNewVersion` (replicates all previous-version assignments at new version, carrying `autoEnroll` forward); `getOutstandingCompletions` (cross-company, one row per assignment with `outstandingCount > 0`, sorted by due date ascending); `diffTemplateSnapshots` (pure — structural diff of two `TemplateSnapshot`s by field/question `id`: added/removed/changed/unchanged); `enrollMatchingUsersForAssignment`/`enrollUserInMatchingAssignments` (auto-enrolment: creates an individual `Assignment` — an audit-trail "enrolled on [date]" record — for each company user whose `jobRole` matches an `autoEnroll` company-wide assignment's `targetJobRoles`; stricter than view-layer filtering — a user with no `jobRole` does not match a role-restricted `autoEnroll` assignment; triggered on assignment creation, user registration, and admin/self-service `jobRole` changes); `getAllDocumentTemplates` (tenant library only — `WHERE ownerCompanyId IS NULL`)/`getDocumentTemplatesByOwnerCompany` (a single company's self-serve templates — used by both the company admin's own template list and Simon's read-only view on the company detail page)
  - Prisma nullable JSON fields: use `Prisma.NullableJsonNullValueInput` / `Prisma.InputJsonValue` (imported from `@/generated/prisma/client`); the shared `toJsonValue` helper in `src/lib/prisma-json.ts` maps `undefined`/`null`/value to the correct write shape (used by `assignments.ts` and `document-templates.ts`)
- **Azurite emulator** — set `USE_AZURITE=true` in `.env.local` for Azure Storage local development; PostgreSQL connects to Neon (or local DB) via `DATABASE_URL`

### Authentication
NextAuth.js v4 with Credentials provider. Users authenticate against Neon PostgreSQL via Prisma; passwords hashed with bcryptjs. Roles are attached to JWT tokens and exposed via session. `src/lib/auth.ts` is the central config; `src/types/next-auth.ts` extends session types; `src/types/rbac.ts` defines roles and permissions.

Password reset tokens are stored in the `PasswordReset` table in PostgreSQL and expire after 1 hour. See `src/lib/password-reset.ts`.

### Email
Transactional email is sent via **Azure Communication Services (Email)** (`@azure/communication-email`). An Azure-managed sending domain (`DoNotReply@<uuid>.azurecomm.net`) is provisioned by Terraform — no custom domain or DNS setup required. Free tier: 100 emails/day. ACS is provisioned as part of the IaC (`infrastructure/modules/communication_service/`).

Three email types are implemented via `src/lib/email.ts`:
- `sendAssignmentNotification(recipients, templateTitle, dueDate, baseUrl)` — triggered fire-and-forget from `POST /api/admin/companies/[id]/assignments` when an assignment is created; individual assignments notify the specific user, company-wide assignments notify all company users filtered by `targetJobRoles`; both paths call `resolveEmailRecipients` so no-email workers route to their line manager
- `sendReminderNotification(recipients, templateTitle, dueDate, isOverdue, baseUrl)` — called by the daily cron job; subject says "Reminder:" or "Overdue:" depending on `isOverdue`
- Password reset — inline in `src/app/api/auth/forgot-password/route.ts`

`resolveEmailRecipients(users: UserData[])` in `src/lib/user-database.ts` — resolves a list of users to `{ email, name }[]` recipients, routing no-email users to their line manager and deduplicating by email (so one manager only gets one notification even if they manage multiple no-email workers in the same batch).

Automated reminders: `src/lib/reminders.ts` exports `isReminderDay(dueDate, today)` (fires on days -3, -1, 0, -7, -14, … relative to due date) and `getAssignmentsNeedingReminders(today)` which queries all due-dated assignments, applies job role filtering, resolves email recipients (including line manager routing for no-email workers), and returns outstanding users per assignment. `GET /api/cron/reminders` is the protected endpoint (`Authorization: Bearer {CRON_SECRET}`). `.github/workflows/reminders.yml` runs the endpoint daily at 08:00 UTC using the `prod` environment.

### App Structure
```
src/app/
  admin/            # Admin dashboard (users, companies, templates, activity logs, settings)
  api/              # Route handlers — auth, documents, folders, scan, shorturl, health, admin/*, customer/*, customer/admin/* (Customer Admin only — completions, templates, assignments, users), signoff/*; customer/assignments/[id]/upload-file and signoff/[companyId]/[assignmentId]/upload-file handle multipart uploads for 'file' form fields; admin/companies/[id]/templates is a read-only view for Simon of a company's self-serve templates; admin/templates/upload-document and customer/admin/templates/upload-document (P19) accept a Word/PDF file and return converted+retained blob paths for DocumentTemplate; customer/assignments/[id]/document (P19) returns a SAS view URL for an upload-based template's source document; admin/templates/[id]/document is the admin-only equivalent, used by view-template-dialog.tsx's Preview tab so Simon can view an upload-based template's source document without leaving the templates list; customer/assignments/[id]/upload-submission (P19 Phase 5) uploads the employee's own filled-in copy for fill-and-return templates, required by customer/assignments/[id]/complete before it will record the completion; admin/assignments (P20) returns every assignment across every company, unfiltered, backing the "Active Assignments" KPI drill-down (`getAllAssignmentsForAdmin` in `src/lib/assignments.ts`); admin/completions/history (P20) returns every completion record via `getAllCompletionsForAdmin`, filtered client-side by signed date, backing the "Completed This Week"/"Completed This Month" KPI drill-downs; admin/templates/[id]/generate-questions (POST) suggests draft comprehension questions via Azure AI Foundry — admin-portal-only, writes nothing to the database, the returned suggestions are only persisted when the admin reviews them and clicks the existing Save/Publish actions in edit-template-dialog.tsx
  customer/         # Customer-facing pages (documents/assignments view); customer/admin/ for Customer Admin-only views (team completions, self-serve template builder at customer/admin/templates — P17)
  signoff/          # Public kiosk pages — no auth required; GET /signoff/[companyId] lists workers + assignments; POST /signoff/[companyId]/[assignmentId]/complete records sign-off
  documents/        # Consultancy staff file browser UI
  scan/             # Document scanning
  shared/           # Public shared document views
  s/                # Short URL redirects
  auth/             # Sign-in, error, forgot-password, reset-password pages
src/components/
  admin/            # Admin UI (includes edit-template-dialog with drag-and-drop form field builder, publish-version-dialog, template-version-history, version-diff-view); create-template-dialog and edit-template-dialog take an optional apiBasePath prop (default /api/admin/templates) so they're reused as-is by the customer/admin/templates self-serve portal; both dialogs also offer a form-vs-upload document-type choice (P19) — upload mode uploads via `${apiBasePath}/upload-document` and shows a read-only/fill-and-return toggle instead of the field builder
  admin/form-builder/ # Form builder sub-components: field-type-palette (click/drag-to-add), sortable-field-card (@dnd-kit drag handle), starter-template-picker
  customer/         # Customer Admin self-serve portal components (P17) — assign-company-template-dialog (company-scoped equivalent of admin/assign-template-dialog)
  providers/        # RBAC, Auth, Theme context providers
  ui/               # Radix UI-based reusable components (includes Textarea, Separator)
  form-field-renderer.tsx # Shared field renderer (customer/kiosk complete pages + admin preview) — one component per FormFieldType
  signature-pad.tsx # Canvas signature capture (react-signature-canvas), used by both completion flows — resizes to its container via ResizeObserver, exposes a trimmed PNG data URL via onChange
src/lib/
  file-system/      # File/folder operation abstractions
  pdf/              # Server-side PDF generation (completion-pdf.tsx uses @react-pdf/renderer; embeds a signature image when signatureDataUrl is provided)
  signature.ts      # isValidSignatureDataUrl — validates a signature is a well-formed, size-capped PNG data URL
  document-text-extraction.ts    # extractTextFromPdfBuffer — server-side PDF text extraction via pdfjs-dist's legacy (Node) build, capped at 20 pages / 15,000 characters
  comprehension-question-source.ts  # getTemplateSourceText — derives generation source material: extracted PDF text for 'upload' templates, title+description+field labels for 'form' templates
  comprehension-question-generation.ts  # generateComprehensionQuestions — calls the Azure AI Foundry model deployment (infrastructure/modules/ai_foundry/), validates/filters the model's output against the same invariants edit-template-dialog.tsx enforces client-side
```

### Key Patterns
- Path alias `@/*` maps to `src/*`
- Tailwind CSS v4 for styling; Radix UI for accessible primitives; `@dnd-kit/core` + `@dnd-kit/sortable` for the form builder's drag-and-drop field reordering and palette drag-to-add
- `next.config.mjs` sets `output: 'standalone'` for Docker deployment
- **Navigation shell**: `src/components/app-shell.tsx` is the single global app shell — a slim top bar plus a role-aware left sidebar (`src/components/app-sidebar.tsx`) that is collapsible-to-icons on desktop (preference persisted in `localStorage` under `sidebar-collapsed`) and a slide-out drawer on mobile. `app-sidebar.tsx` builds nav groups from the user's roles (admin, tenant staff, customer, customer admin) and is the one source of truth for primary nav — the admin/customer layouts no longer carry their own sidebars, only their page guards. Public/kiosk routes (`/auth`, `/signoff`, `/shared`, `/s/`) and signed-out users get a minimal top-bar-only chrome instead of the sidebar.
- **Breadcrumbs**: `src/components/breadcrumbs.tsx`, rendered at the top of `AppShell`'s main content area, shows a trail on nested pages only (hidden when there'd be fewer than two crumbs — top-level pages rely on the sidebar's active state instead). It derives static segment labels from a `ROUTE_LABELS` map and resolves dynamic id segments (company/template/completion names) via a registry populated by the pages themselves through `useBreadcrumbLabel(path, label)` (`src/components/providers/breadcrumb-provider.tsx`, `BreadcrumbProvider` wraps `AppShell` in the root layout) — e.g. `admin/companies/[id]/page.tsx` calls `useBreadcrumbLabel(`/admin/companies/${id}`, company?.name)` once the company loads. Trailing action segments (`view`, `complete`) fold into the entity crumb before them rather than appearing as their own crumb. `/documents` is excluded — the file browser has its own in-page folder breadcrumb (`document-breadcrumb.tsx`).
- **Account menu**: `src/components/user-menu.tsx` — an avatar (initials) dropdown in the top bar grouping Profile and Sign Out; the sidebar no longer carries an account footer (`app-sidebar.tsx`'s `SidebarRow` is link-only now, the old button/onClick branch was removed as dead code).
- **Notification bell**: `src/components/notification-bell.tsx` — top bar bell showing an overdue-completions badge, polled every 5 minutes. Visible only to Admin (via `/api/admin/dashboard/stats`'s `overdue` KPI) and Customer Admin (via `/api/customer/admin/completions`'s `isOverdue` groups) — the roles responsible for chasing outstanding sign-offs; links to the relevant outstanding/overdue view. Not shown to individual customer users or tenant staff.
- **Welcome header**: `src/components/customer/welcome-header.tsx` — a one-line "Welcome back, {first name}" + status subtitle used on the customer landing pages (`/customer/documents`, `/customer/admin/completions`) for orientation; subtitle reflects pending/outstanding counts once loaded.
- **Landing route**: `src/app/page.tsx` (`/`) is a server-side role redirect, not a page — admin → `/admin` (dashboard), customer admin → `/customer/admin/completions`, customer user → `/customer/documents`, tenant staff → `/documents`, signed-out → `/auth/signin`. The relevant dashboard/list is each role's home; there is no standalone home page.
- `src/proxy.ts` is the Next.js 16 proxy (formerly middleware) — guards `/documents` and `/scan` routes with auth; named `proxy` not `middleware`. (Document scanning at `/scan` is built but currently unlinked from navigation — it will return later.)
- All activity is logged to Azure Table Storage for auditing

## Environment Variables

Required in `.env.local`:
```env
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER_NAME=documents
NEXTAUTH_SECRET=
NEXTAUTH_URL=
DEFAULT_ADMIN_EMAIL=
AZURE_COMMUNICATION_CONNECTION_STRING=  # provisioned by Terraform via Key Vault
ACS_SENDER_ADDRESS=                     # auto-set by Terraform (DoNotReply@<uuid>.azurecomm.net)
USE_AZURITE=true         # local dev only
DATABASE_URL=            # Neon connection string (or local PostgreSQL for dev)
CRON_SECRET=             # random secret; must also be set as GitHub Actions secret for reminders workflow
GOTENBERG_URL=            # base URL of the Gotenberg conversion service, e.g. http://localhost:3000 for local dev (docker run --rm -p 3000:3000 gotenberg/gotenberg:8)
GOTENBERG_BASIC_AUTH_USERNAME=  # only set in deployed environments (Terraform-provisioned, public Container App is locked down with basic auth)
GOTENBERG_BASIC_AUTH_PASSWORD=  # only set in deployed environments
AI_FOUNDRY_ENDPOINT=      # Azure AI Foundry account endpoint (Terraform-provisioned, infrastructure/modules/ai_foundry/)
AI_FOUNDRY_KEY=           # Azure AI Foundry account key
AI_FOUNDRY_DEPLOYMENT_NAME=  # model deployment name used for comprehension question generation
AI_FOUNDRY_API_VERSION=   # optional; defaults to 2024-10-21 if unset
```

## Deployment

Docker → GitHub Container Registry (ghcr.io) → Azure App Service.

CI/CD via GitHub Actions (`main` branch → dev, release → prod). Deploy order: lint → security scan → Docker build/push → **`prisma migrate deploy`** → Azure App Service deploy → **smoke test** (`GET /api/health/deep` with 12 retries × 15 s). `DATABASE_URL` must be set as a GitHub environment secret (`dev` and `prod` environments).

**Health checks are split in two** (`src/app/api/health/route.ts` vs `src/app/api/health/deep/route.ts`): `GET /api/health` is a plain liveness check (no DB/storage calls) — it's the path Azure App Service's built-in health monitor (`health_check_path`, `infrastructure/modules/app_service/`) pings continuously (~every 60 s, for the app's whole lifetime), and a real Neon query on every ping would keep the compute endpoint awake around the clock and defeat autosuspend, burning through Neon's free-tier compute-hour quota in days. `GET /api/health/deep` runs the real DB (`SELECT 1`) + Blob Storage (`getProperties`) checks and is used only by the CI/CD smoke test, which needs to verify actual dependency health after a deploy.

Infrastructure is defined with Terraform in `infrastructure/` (see `infrastructure/readme.md` for provisioning steps). `database_url` is a required Terraform variable — stored in Key Vault and injected into App Service via `@Microsoft.KeyVault(...)` reference.

**Postgres backup/scale-up path**: `infrastructure/modules/postgres_flexible_server/` scaffolds an Azure Database for PostgreSQL Flexible Server module — deliberately not referenced by `modules/minato/main.tf`, so it provisions nothing and costs nothing until wired in. No app code change is needed to switch from Neon: `src/lib/prisma.ts` only reads `DATABASE_URL`, and Flexible Server is wire-compatible standard Postgres, so cutover is a module block + a `DATABASE_URL` app-setting swap (see "Optional modules" in `infrastructure/readme.md`).

**Gotenberg** (`infrastructure/modules/gotenberg/`) — an Azure Container App (Consumption plan, scales to zero between conversions) running `gotenberg/gotenberg:8`, used to convert uploaded Word documents to PDF (`src/lib/document-conversion.ts`). Previously ran on Azure Container Instances, which billed for a fixed-size container around the clock; moved to Container Apps because it has its own free monthly grant (vCPU-seconds/GiB-seconds/requests) independent of the App Service Free (F1) tier's shared 60 CPU-minute/day-per-region budget, and only bills for actual conversion time. It is *not* VNet-isolated: the App Service Plan is on the Free (F1) SKU, which doesn't support regional VNet integration, so the Container App is reachable over the public internet (ingress TLS-terminated by the platform) and locked down with Gotenberg's built-in basic auth instead (credentials generated by Terraform, stored in Key Vault, injected as `GOTENBERG_BASIC_AUTH_USERNAME`/`PASSWORD`). Revisit with VNet-scoped ingress if the App Service Plan is ever upgraded to Basic (B1) or above.

## Code Style

### Formatting (Prettier)
- No semicolons
- Single quotes for JS/TS strings and JSX attributes
- No trailing commas
- LF line endings

### Linting (ESLint)
- `console.log` is disallowed — use `console.warn` or `console.error` only
- Unused variables are errors; prefix intentionally unused parameters with `_`
- React prop-types are off (TypeScript handles this)
- `react-hooks/rules-of-hooks` is an error; `exhaustive-deps` is a warning

**Import ordering** is enforced and must follow this group sequence, with a blank line between each group, alphabetised within each group:
1. Node built-ins
2. External packages
3. Internal (`@/` aliases)
4. Parent (`../`)
5. Sibling (`./`)
6. Index
7. Object imports
8. Type imports

Husky runs pre-commit checks. Run `npm run checks` before committing to catch all issues.

## Documentation Maintenance

After every meaningful change, update these three files to reflect the new state:
- **`README.md`** — user-facing: update the Testing table, commands, or any section affected by the change
- **`CLAUDE.md`** — Claude-facing: update architecture notes, testing coverage, or any guidance that has changed
- **`future-considerations.md`** — update the status of anything completed, and add any new decisions or considerations that emerged

## Business Context

Health and safety document management platform. Primary user: a small H&S consultancy (Simon) serving up to 100 client businesses. Alan is the sole developer. Future potential: market the platform to other H&S companies (SaaS).

Core document model:
- **Templates** — reusable H&S documents maintained by the consultancy; support comprehension questions and versioning
- **Assignments** — templates assigned to specific customers (individual or company-wide); job role filtering; version tracking
- **Completions** — customer signs an assigned document; immutable signed PDF with audit trail

## Testing Strategy

**Stack:** Vitest (unit + integration), Playwright (E2E — not yet written).

**Current coverage:**
- Unit: full coverage of `src/lib/` and `src/lib/file-system/`
- Integration:
  - `health` (liveness, no dependency calls) and `health/deep` (DB + Blob Storage checks)
  - Admin: user CRUD (`jobRole`, `lineManagerId` PATCH), password reset flows, document API routes, companies/templates/assignments CRUD (company-wide + individual; comprehension questions PATCH; `dueDate`; `targetJobRoles`; notification emails; no-email line manager routing), completions (list + download + status summary with outstanding users and overdue); company completions list (`GET /api/admin/companies/[id]/completions`) is grouped one row per template — superseded versions are dropped (only the current/highest version is shown, since only it can still be completed) and multiple assignments of the same template+version (company-wide + individually auto-enrolled users) are merged into a single row with aggregated completion/outstanding counts; `GET /api/admin/companies/[id]/completions/[templateId]` (`getTemplateCompletionSummaryForCompany`) returns the merged detail view (completions + outstanding users pooled across all current-version assignments for that template)
  - Customer: assignments (list with `jobRole` filtering, get single, complete with field + answer validation, download), completions (list + PDF download)
  - Customer Admin (company-scoped): completions list (auth, role check, company scope from session), assignment status (cross-company 404, blobPath→hasPdf stripping), PDF download (assignment+company chain validation, missing blobPath 404, success SAS URL)
  - Cron: reminders (auth, zero sends, send count, 500 error, `lastReminderSentAt` update skipped/called)
  - Kiosk sign-off: `GET /api/signoff/[companyId]`, `POST /api/signoff/[companyId]/[assignmentId]` (worker validation, comprehension check, completion recording)
  - Document version cycle: `POST /api/admin/templates/[id]/publish-version` (auth, 404, 400 when `changeReason` missing/blank, success, 500); `templateVersion` on assignment creation; `publishNewTemplateVersion`; `createAssignmentsForNewVersion`; version-aware deduplication in `getAssignmentsForUser`
  - Template version history: `GET /api/admin/templates/[id]/version-history` (auth, 404, current-only when no history, combined current+history sorted desc with resolved author names, 500); lib unit tests cover `createTemplateVersionHistoryEntry`/`getTemplateVersionHistory` and the pure `diffTemplateSnapshots` diff logic (title/description/form field/question added/removed/changed/unchanged)
  - Dashboard: `GET /api/admin/dashboard/stats` (auth, 200 with KPIs, 500); `GET /api/admin/dashboard/completions` (auth, empty list, recent completions, limit param, cap at 20, 500)
  - Admin users list: `GET /api/admin/users` returns `customerCompanyName` (resolved via parallel company fetch); tests cover name resolution and null fallback
  - Activity logs: `GET /api/admin/activity` (auth, role access for Tenant Staff, basic list, userId filter, companyId→userIds resolution, empty company, date range normalisation, limit, 500)
  - Compliance KPIs: `GET /api/admin/dashboard/compliance-kpis` (auth, 200 with full KPI object, 500); lib unit tests cover: empty data, 12-month span, completion rates sorted ascending, monthly bucketing, template avg-days, coverage gaps, overdue user counting and deduplication
  - Outstanding completions: `GET /api/admin/completions/outstanding` (admin-only, 200 with rows, 500); lib unit tests cover: assignments with no outstanding users excluded, individual vs company-wide `assignedTo` labelling (job role list or "All staff"), overdue flagging + days-overdue calculation, `lastReminderSentAt` passthrough, due-date sort with nulls last
  - Auto-enrolment (P16): `POST /api/admin/companies/[id]/assignments` (`autoEnroll` passthrough, enrolls matching existing users on company-wide creation, skipped for individual assignments); `POST /api/auth/register` (enrolls a newly created customer user, skipped when no `customerCompanyId`); `PATCH /api/admin/users/[id]` and `PATCH /api/profile` (re-run matching on `jobRole` change, skipped when `jobRole` untouched or no `customerCompanyId`); lib unit tests cover `enrollMatchingUsersForAssignment`/`enrollUserInMatchingAssignments`: role match/no-match, null `targetJobRoles` (all staff), no-`jobRole` user does not match a role-restricted assignment, already-enrolled dedup, error paths
  - Form builder field types (P16b): `getMissingRequiredFields`/`getVisibleFormData` (`src/lib/form-validation.ts`) unit tests cover text/checkbox/number/select/file required-field checks and `section` exclusion; `starter-templates.ts` unit tests cover preset shape and unique ids; `completion-pdf.tsx` unit test renders a PDF covering every field type including `file`/`section`; both completion routes (`customer/assignments/[id]/complete`, `signoff/[companyId]/[assignmentId]`) have tests for the new field types' required-field validation; new `upload-file` routes (customer + kiosk) covered for auth, field-type validation, 10MB size limit, and success
  - Self-serve portal (P17): `getAllDocumentTemplates`/`getDocumentTemplatesByOwnerCompany` unit tests cover tenant-vs-company scoping; `GET/POST /api/customer/admin/templates` and `GET/PATCH/DELETE/publish-version /api/customer/admin/templates/[id]` (Customer Admin role gate, no-company 403, ownership-checked 404 when a template belongs to another company or the tenant library, scoped creation); `GET/POST /api/customer/admin/assignments` (company-wide only, rejects templates not owned by the session company, duplicate-assignment 409, autoEnroll + notification passthrough reusing the same lib functions as the main admin route); `GET /api/customer/admin/users` (job-role lookup for the assign dialog); `GET /api/admin/companies/[id]/templates` (admin-only read-only view of a company's self-serve templates)
  - Upload-based documents (P19): `document-conversion.ts` (`isPdfMimeType`/`isConvertibleToPdf`/`convertToPdf` — mocked `fetch` against the Gotenberg API, Basic auth header, error propagation); `document-upload.ts` (`uploadSourceDocument` — PDF passthrough, Word conversion + retained original, filename sanitisation, unsupported-type rejection); `storage.ts` (`uploadBlob`); `document-templates.ts`/`completion-records.ts` extended create/update/publish functions carrying the new fields (including through `TemplateVersionHistory` snapshots); `assignments.ts` (`getAssignmentWithTemplate` mapping the new template fields); `POST /api/admin/templates/upload-document` and the customer-admin equivalent (auth, size limit, unsupported-type 400, conversion-failure 500, success); create/publish-version routes (admin + customer-admin) passing the new fields through; `GET /api/customer/assignments/[id]/document` (auth, company-scoped 404, non-upload-template 404, success SAS URL); `GET /api/admin/templates/[id]/document` (admin-only equivalent for the Preview tab: auth, template-not-found 404, non-upload-template 404, success SAS URL, 500 on SAS generation failure)
  - Fill-and-return (P19 Phase 5): `POST /api/customer/assignments/[id]/upload-submission` (auth, company-scoped 404, 400 when the template isn't `fill-and-return`, size limit, unsupported-type 400, conversion-failure 500, success); `POST /api/customer/assignments/[id]/complete` extended with tests for 400 when a fill-and-return template's submission is missing, 200 with `submittedBlobPath`/`submittedOriginalBlobPath`/`submittedFileName` passed through to `createCompletionRecord` when present, and confirming a submission is *not* required for read-only upload templates
  - Signature pad: `signature.ts` (`isValidSignatureDataUrl` — PNG data URL format + size-limit validation) unit tests; `completion-pdf.tsx` test covers embedding a signature image and rendering without one; both completion routes (`customer/assignments/[id]/complete`, `signoff/[companyId]/[assignmentId]`) require `signatureDataUrl` (400 when missing/invalid) and pass it through to `generateCompletionPDF`
  - Dashboard drill-downs and template categories (P20): `dashboard.ts` (`getDashboardKPIs` — Monday-start `completedThisWeek` window including the Sunday-rollback edge case, calendar-month `completedThisMonth`, unit-tested directly against mocked Prisma for the first time); `GET /api/admin/dashboard/stats` extended for the new `completedThisWeek` field; `getAllAssignmentsForAdmin` (`src/lib/assignments.ts` — unscoped, unfiltered, mirrors the KPI's raw `assignment.count()`) + `GET /api/admin/assignments`; `GET /api/admin/completions/history` (thin wrapper over the existing unfiltered `getAllCompletionsForAdmin`, no lib changes needed); `document-templates.ts`'s `category` field threaded through create/update/publish (including the `TemplateVersionHistory` snapshot, editable at publish time like `title`/`description`) and both admin + customer-admin template routes (create passthrough, publish-version passthrough)
  - LLM-generated comprehension questions: `storage.ts` (`downloadBlob`); `document-text-extraction.ts` (`extractTextFromPdfBuffer` — mocked `pdfjs-dist/legacy/build/pdf.mjs`, page/character truncation, parse-failure error); `comprehension-question-source.ts` (`getTemplateSourceText` — form-template field-label concatenation with `section` fields excluded, upload-template PDF extraction, missing-blob-path and too-short-extracted-text errors); `comprehension-question-generation.ts` (`generateComprehensionQuestions` — mocked `fetch` against the Azure AI Foundry chat-completions endpoint, missing-env-var guard, invalid-answer/duplicate-option filtering, all-invalid and non-JSON/non-ok-response error paths); `POST /api/admin/templates/[id]/generate-questions` (auth, 404, 400 on source-text failure, 500 on generation failure, success returning the suggested questions) — admin-portal-only, nothing is persisted by this route
- E2E: not yet started

**TDD workflow:** define interface types → write tests → implement to pass tests. Always request tests before implementation. Target >90% coverage on `src/lib/`.

**Test discipline (non-negotiable):**
- Update existing tests whenever code changes
- Write new tests whenever new code is added
- Run `npm run checks` before every commit

Add E2E tests (Playwright) once the document model is more stable. Add E2E step to CI after the Playwright suite exists.

## Future Considerations

See `future-considerations.md` for full architectural analysis. Key items still pending:

- **Electronic signing** — server-side PDF (React-PDF) + audit trail + canvas signature pad all done; third-party e-signing only if legally required
- **Multi-tenancy** — schema has `Tenant` model and nullable `tenantId` on `User`; build it when needed
- **Compliance** — GDPR (UK); data retention policy needed; signed documents retained 3–5 years under UK H&S law
