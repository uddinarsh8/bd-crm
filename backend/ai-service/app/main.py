from fastapi import FastAPI

app = FastAPI(
    title="BD CRM AI Service",
    description="Optional AI capabilities called by the authorized Python CRM API.",
    version="0.1.0",
)


@app.get("/health", tags=["health"])
def health() -> dict[str, str | bool]:
    return {"ok": True, "service": "BD CRM AI Service", "featuresEnabled": False}
