# BD CRM

BD CRM is a business development workspace for managing customer accounts, stakeholder contacts, conversations, follow-ups, staffing requirements, and relationship reports.

## Project structure

```text
bd-crm/
├── frontend/                 React and TypeScript web application
│   ├── public/sample-imports/ Example Excel files available in the demo
│   ├── scripts/               Frontend-specific data generation scripts
│   └── src/
│       ├── components/        Shared layout and interface components
│       ├── data/              Demo seed records
│       ├── pages/             Screens and page workflows
│       ├── store/             Shared app state
│       └── utils/             API, CSV, and scorecard helpers
├── backend/
│   ├── crm-api/               Main FastAPI backend and database migrations
│   │   ├── app/                API, models, settings, and notification worker
│   │   └── alembic/            PostgreSQL schema migrations
│   └── ai-service/            Separate optional AI service
├── docs/                      Architecture, workflows, and delivery plans
├── scripts/                   Repository-level document generation tools
├── .env.example               Example local environment settings
└── README.md                  Setup and project guide
```

Generated folders and local secrets such as `node_modules`, `dist`, `.venv`, `.env`, TypeScript build metadata, and Vercel local settings are excluded from source control.

## Technology

- React and TypeScript for the responsive web application.
- Node.js and npm are used only for the frontend development/build tools; there is no Node.js CRM backend.
- Python FastAPI for CRM rules, sign-in, roles, imports, audit history, reports, and notifications.
- PostgreSQL with SQLAlchemy and Alembic for shared CRM data and versioned schema changes.
- A separate Python FastAPI service is reserved for optional AI features. It currently exposes only a health endpoint and has no CRM database access.
- Vercel can host the frontend; the API and PostgreSQL database need a separate host.

## Run the browser demo

```powershell
cd frontend
npm install
npm run dev
```

Without `VITE_API_URL`, the app uses sample personas and saves demo changes in this browser's local storage. This mode is for demonstrations and is not shared across people or devices.

## Run the FastAPI CRM backend locally

Install Python 3.12 and PostgreSQL. Then run from the repository root:

```powershell
cd backend/crm-api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:DATABASE_URL = 'postgresql+psycopg://bdcrm_app:YOUR_PASSWORD@localhost:5432/bdcrm'
$env:JWT_SECRET = 'replace-with-a-random-secret-of-at-least-32-characters'
$env:BOOTSTRAP_KEY = 'a-separate-one-time-secret'
$env:FRONTEND_BASE_URL = 'http://localhost:5173'
$env:ALLOWED_ORIGINS = 'http://localhost:5173'
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

In a second terminal, start the notification worker so due and overdue follow-ups are emailed daily and the leadership summary is emailed on Mondays after 9:00 a.m. India time:

```powershell
cd backend/crm-api
.\.venv\Scripts\Activate.ps1
python -m app.worker
```

Set the `SMTP_*` environment values before starting the worker. Run one worker instance for the database.

Create the first administrator once by sending `POST /api/auth/bootstrap-admin` with `{ "key": "...", "email": "...", "fullName": "...", "password": "..." }`. The route works only before any users exist.

Set `frontend/.env.local` to connect the browser to the API:

```text
VITE_API_URL=http://localhost:8000
```

Configure `ALLOWED_ORIGINS` with the frontend origin. PostgreSQL must be reachable from the API host; the browser never accesses the database directly.

## Workflows and status

The API provides authentication, role checks, accounts, contacts, activities and meetings, follow-ups, requirements and position fulfilment, scorecards, reports, import preview and confirmation, administration, audit history, saved contact views, recently viewed contacts, and scoped CSV exports.

See [the functional requirement status and rollout plan](docs/REQUIREMENTS_AND_TECHNICAL_PLAN.md), [the architecture](docs/ARCHITECTURE.md), and [PostgreSQL setup](docs/DATABASE_MIGRATIONS.md). Run the Alembic migration against a clean development database and do a requirement-by-requirement acceptance review before deployment.
