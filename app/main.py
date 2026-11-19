from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.config import settings
from app.routers import discovery, graph_upload, export, simplification, pm_library


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.app_name,
        description="Process Mining Graph Visualization Backend",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # CORS — allow all origins for development
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Create uploads directory on startup
    @application.on_event("startup")
    async def startup_event():
        settings.upload_dir.mkdir(parents=True, exist_ok=True)

    # Routers
    application.include_router(discovery.router, prefix="/api/v1/discovery", tags=["Discovery"])
    application.include_router(graph_upload.router, prefix="/api/v1/graphs", tags=["Graph Upload"])
    application.include_router(export.router, prefix="/api/v1/export", tags=["Export"])
    application.include_router(simplification.router, prefix="/api/v1/simplification", tags=["Simplification"])
    application.include_router(pm_library.router, prefix="/api/v1/pm-library", tags=["PM Library"])

    @application.get("/health", tags=["Health"])
    async def health_check():
        return {"status": "ok", "app": settings.app_name}

    @application.get("/", include_in_schema=False)
    async def root():
        return RedirectResponse(url="/docs")

    return application


app = create_app()
