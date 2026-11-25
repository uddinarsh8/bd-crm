# BD CRM AI service

This separate FastAPI service is reserved for future AI capabilities. It currently exposes only a health endpoint; no AI feature is active.

The FastAPI CRM backend remains responsible for authentication, authorization, and CRM data. The AI service must not connect directly to PostgreSQL. Any future suggestion must be reviewed by a user before it is saved.

Run after installing Python dependencies:

```bash
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```
