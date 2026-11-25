# PostgreSQL setup for the CRM API

The CRM API uses PostgreSQL through SQLAlchemy. The initial Alembic revision is `backend/crm-api/alembic/versions/20261124_0001_initial_schema.py`. It creates the CRM tables, standard dropdown values, a starting 20% margin, and a database trigger that prevents audit records from being changed or deleted.

## Apply the schema

1. Create a PostgreSQL database and an application database user.
2. Configure `DATABASE_URL`, `JWT_SECRET`, `BOOTSTRAP_KEY`, `FRONTEND_BASE_URL`, and `ALLOWED_ORIGINS` through environment variables or a hosting provider's secret store.
3. From `backend/crm-api`, install `requirements.txt` and run `alembic upgrade head`.
4. Start the API and create the first Administrator with `POST /api/auth/bootstrap-admin`. The endpoint only works before any users exist; rotate the bootstrap key after setup.
5. Set `VITE_API_URL` in the frontend build to the API's HTTPS origin.

For a disposable local database only, `CREATE_SCHEMA_ON_START=true` creates tables from SQLAlchemy metadata. It does not provide schema history and is not a replacement for Alembic migrations.

The initial migration must be reviewed and applied against a clean development database before production. Future schema changes need new Alembic revisions.

## Optional AI service

The separate AI service currently provides only `/health` and has no database connection or active AI feature. Keep authentication and authorization in the CRM API if an AI endpoint is added later.
