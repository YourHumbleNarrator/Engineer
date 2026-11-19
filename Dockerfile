# ── Stage 1: R + Python base ───────────────────────────────────────────────
FROM python:3.11-slim AS base

# Install R and system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    r-base \
    r-base-dev \
    libxml2-dev \
    libcurl4-openssl-dev \
    libssl-dev \
    libfontconfig1-dev \
    libharfbuzz-dev \
    libfribidi-dev \
    libfreetype6-dev \
    libpng-dev \
    libtiff5-dev \
    libjpeg-dev \
    graphviz \
    && rm -rf /var/lib/apt/lists/*

# Install R packages for bupaR ecosystem
RUN Rscript -e "install.packages(c('jsonlite', 'bupaR', 'processmapR', 'heuristicsmineR', 'petrinetR'), repos='https://cloud.r-project.org', Ncpus=4)"

# ── Stage 2: Python dependencies ──────────────────────────────────────────────
FROM base AS deps

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Stage 3: Application ──────────────────────────────────────────────────────
FROM deps AS app

WORKDIR /app

COPY . .

RUN mkdir -p uploads

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
