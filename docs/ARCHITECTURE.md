# BD CRM architecture

```text
React + TypeScript
        | HTTPS / JSON
        v
Python FastAPI CRM API -------- PostgreSQL
        |
        +--- Optional authorized AI request --- Python FastAPI AI service
```

## Service ownership

- **FastAPI CRM API** owns sign-in, roles, contact ownership checks, business rules, CRM workflows, audit records, imports, exports, reports, and email notifications.
- **PostgreSQL** is the shared source of truth. SQLAlchemy handles data access; Alembic versions schema changes.
- **Optional FastAPI AI service** currently exposes `/health` only. It has no CRM database connection. Future AI output should remain a draft for user review.
- **React** supports a local-storage browser demo and API mode selected with `VITE_API_URL`. In API mode, CRM records remain in memory in the browser and are saved through FastAPI.
- **Vercel** can host the frontend. The API and database run separately; the frontend never connects to PostgreSQL directly.

## API areas

Authentication and password setup; account/contact management; activity and formal meeting logging; task queues and completion; requirements linked to meetings; position progression and commercial calculations; contact/account scorecards; role filtered reports; contact import; administration; administrator audit history; per user saved views and recently viewed contacts; and role scoped CSV exports.

## Delivery status

The C#/.NET API has been removed from the active workspace and replaced with Python FastAPI. SQLAlchemy models and an initial Alembic revision are present. Python syntax compilation and the frontend production build passed. The migration still needs to be run against a clean PostgreSQL database; production also needs SMTP, deployment secrets, and role-by-role workflow acceptance. The API could not be imported here because network restrictions prevented installation of its Python dependencies.

## Security

The API checks roles and record ownership on protected requests. Password reset tokens are hashed and single use; setup links expire; failed logins trigger a timed lock; idle sessions expire; and the browser stores the session token only for the current session. The migration adds an append only audit trigger. AI suggestions must remain drafts for user review.
