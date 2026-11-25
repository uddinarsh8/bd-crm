from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://bdcrm_app:replace-me@localhost:5432/bdcrm"
    jwt_secret: str = "change-this-to-a-random-secret-of-at-least-32-bytes"
    jwt_issuer: str = "bd-crm"
    jwt_audience: str = "bd-crm-web"
    frontend_base_url: str = "http://localhost:5173"
    allowed_origins: str = "http://localhost:5173"
    bootstrap_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    create_schema_on_start: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
