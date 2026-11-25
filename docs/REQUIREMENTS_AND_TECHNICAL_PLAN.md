# Functional requirements and delivery plan

## Current status

The React demo now has an optional Python FastAPI backend connected through `VITE_API_URL`. It uses PostgreSQL for shared data, SQLAlchemy for database access, and Alembic for schema changes. Without the API setting, the app continues to run with sample records saved in the current browser.

“Implemented in code” means that the UI and API workflow have been added. It does not mean the connected service has been deployed or accepted. The API still needs a real PostgreSQL run, migration review, role-by-role acceptance, and production setup.

## Phase 1 requirements

| ID | Requirement area | Current implementation |
|---|---|---|
| FR-1 | Secure sign-in | API has login, password setup/reset, single-use hashed reset tokens, failed-login lockout, inactivity expiry, and forced password change. Verify against a running database and review security before production. |
| FR-2 | Roles and visibility | Server-side role and record visibility checks are implemented for CRM routes. Review every route and export with all roles before release. |
| FR-3 | Administration | UI and API support users, roles, activation, password setup/reset, dropdown values, and report recipients. Confirm approved values and owner assignment rules. |
| FR-4 | Accounts and contacts | Create/edit, owner assignment, reporting hierarchy, duplicate checks, relationship rating, and annual target fields are supported. Confirm field rules with BD users. |
| FR-5 | List views and search | Contact filters, sorting, search, saved views, and recently viewed contacts are supported. Search covers records the signed-in user can access. |
| FR-6 | Log activity | The API supports calls, emails, messages, events, and meetings; formal meeting validation; contact stage/summary updates; follow-up creation; and audit history. |
| FR-7 | Tasks and follow-ups | Owner-scoped task lists and completion are supported. A FastAPI-side worker now sends daily due/overdue reminders when SMTP is configured; deployment still needs the worker running. |
| FR-8 | Home page | The dashboard shows CRM records, shortcuts, and recent contacts. Report totals are served by the API. |
| FR-9 | Import and migration | Contact import supports review, row errors, confirmation, and rejected-row download. Legacy data migration, large files, and full import acceptance remain. |
| FR-10 | Change history | Core changes are audit logged and administrator history is read-only. Confirm action coverage and database protections on PostgreSQL. |
| FR-11 | Meetings and engagement stage | Formal meetings require level and attendees; stage derives from recorded activities and requirements. Meetings share the activity records. |
| FR-12 | Requirement record | A requirement can be linked to a stakeholder and source formal meeting. Status and position changes are audited. |
| FR-13 | Contact page | Profile, timeline, requirements, hierarchy, annual target, and account/reporting scorecards are available. Validate calculations and visibility. |
| FR-14 | Reports and dashboards | Role-filtered data is available for pipeline, weekly activity, overdue follow-ups, open requirements, quiet contacts, hierarchy, and completeness. Review drill-downs and totals with users. |
| FR-15 | Notifications | Notification settings, password emails, daily follow-up reminders, and a Monday leadership summary are implemented. SMTP delivery and the deployed worker still need configuration and verification. |
| FR-16 | Export | Scoped CSV exports now cover core records and the reports dashboard. Confirm access rules with each role before production. |

## Phase 2: commercial tracking

The demo includes contract, permanent-hire, and project/RPO requirement fields; required commercial terms; configurable default margins for each engagement type; potential and realised revenue/margin calculations; individual candidate positions; fill and conversion metrics; stakeholder/account scorecards; and annual targets. The default margins start at 20% and can be changed by an Administrator. Confirm the formulas, target period, and currency rules with the business before acceptance.

## Technology choices

| Layer | Choice | Why |
|---|---|---|
| Web app | React + TypeScript | Keeps the existing responsive demo and its typed screens. |
| CRM backend | Python FastAPI | Provides HTTP APIs, validation, permissions, and business workflows. Python also gives a direct path to future AI features. |
| Database access | SQLAlchemy | Maps Python CRM records to PostgreSQL and supports structured queries. |
| Schema history | Alembic | Tracks database changes as reviewable, ordered migrations. |
| Database | PostgreSQL | Stores shared, linked CRM records with relational integrity. |
| Optional AI | Separate Python FastAPI service | Keeps future AI experiments separate; currently it exposes health only and has no CRM data access. |
| Hosting | Vercel frontend + separately hosted API/database | Vercel serves the web app; the API and database need a backend host. |

The previous .NET and Node/Prisma backends are removed from the active project. The supported CRM backend is Python FastAPI.

## Remaining execution plan

1. Install the API dependencies and run the service against a clean development PostgreSQL database.
2. Review and apply the Alembic migration; resolve schema and runtime issues found.
3. Confirm dropdown values, default margins, calculation formulas, annual target period, and currency rules with BD stakeholders.
4. Review each API action with Administrator, BD Lead, User, and Leader access, including imports, exports, reports, and hierarchy visibility.
5. Exercise the connected frontend with sample records, import files, password flows, calculations, and responsive screens.
6. Configure production secrets, PostgreSQL backups, and SMTP; deploy both the API and its notification worker, then deploy the frontend.
7. Complete legacy data mapping, user acceptance, and operational checks before entering real client data.
8. Add AI only for an approved use case. Keep CRM authorization in the main API and require human review of AI suggestions.
