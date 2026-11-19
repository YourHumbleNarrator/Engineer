from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    app_name: str = "ProcessMiningBackend"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8000
    upload_dir: Path = Path("./uploads")
    max_upload_mb: int = 50
    r_enabled: bool = True

    class Config:
        env_file = ".env"


settings = Settings()
