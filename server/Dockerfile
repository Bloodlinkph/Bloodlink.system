    # BloodLink backend (Flask) for Railway or any Docker host.
    # The "mariadb" Python driver needs the MariaDB C library, which is installed here.
    FROM python:3.12-slim

    RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libmariadb-dev \
    && rm -rf /var/lib/apt/lists/*

    WORKDIR /app
    COPY requirements.txt .
    RUN pip install --no-cache-dir -r requirements.txt

    COPY bloodlink.py .

    ENV PYTHONUNBUFFERED=1
    # 1) bring the database up to date (safe to run on every start)
    # 2) start the web server on the port Railway gives us
    CMD python -c "import bloodlink; bloodlink.migrate_to_member_accounts()" \
    && exec gunicorn bloodlink:app --bind 0.0.0.0:${PORT:-5000} --workers 2 --threads 4 --timeout 60 --access-logfile -