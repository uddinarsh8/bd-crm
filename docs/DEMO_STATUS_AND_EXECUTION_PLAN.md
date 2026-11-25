# BD CRM demo and implementation status

## What is in the workspace

The demo covers accounts, contacts, activity and meeting logging, follow-ups, requirements, pipeline, reports, audit history, administration, and contact import review. Without API settings, it uses sample records stored in the current browser.

With `VITE_API_URL` configured, the React app signs in through the Python FastAPI CRM API and uses PostgreSQL-backed records. The backend includes role and record visibility checks. It has not yet been run against a provisioned database or deployed as a production service.

## Main roles

| Role | Main access |
|---|---|
| Administrator | Manage users, roles, dropdowns, notification recipients, and audit history; access CRM records. |
| BD Lead | Manage shared accounts, contacts, and requirements; assign owners and review requirement status. |
| User | Work with assigned contacts, activities, follow-ups, and related requirements. |
| Leader | View portfolio and reports without changing CRM records. |

Permissions are enforced by the API, not only by hiding page controls.

## Technology

| Part | Technology | Purpose |
|---|---|---|
| Web application | React + TypeScript | Responsive screens and forms. |
| CRM backend | Python FastAPI | Login, permissions, validation, CRM workflows, reports, and imports. |
| Shared database | PostgreSQL + SQLAlchemy | Store linked CRM data for the team. |
| Schema changes | Alembic | Keep ordered, reviewable database migrations. |
| Future AI | Separate Python FastAPI service | A place for approved AI features later; currently health-only. |
| Web hosting | Vercel | Host the frontend; API and database need separate hosting. |

## What remains before production

Install the Python dependencies, run the API with PostgreSQL, apply and review the Alembic migration, and resolve any runtime issues. Confirm the requirements and commercial formulas with BD users. Review access for all four roles, configure SMTP and scheduled notifications, connect production hosting, and complete user acceptance, backups, and recovery checks. Contact saved views and recently viewed contacts are stored per user in API mode; browser demo data stays local to that browser. Do not use browser-only demo mode for real client data.

See the [detailed requirement status and execution plan](REQUIREMENTS_AND_TECHNICAL_PLAN.md), [architecture](ARCHITECTURE.md), and [database setup](DATABASE_MIGRATIONS.md).
