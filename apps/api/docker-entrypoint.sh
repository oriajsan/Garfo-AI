#!/bin/sh
# Container start (D4.3): prepare the database, then run the API. All steps are idempotent,
# so restarting never duplicates data and never pays for embeddings twice.
# Set DB_BOOTSTRAP_ON_START=false when the database is prepared from outside (Neon + `pnpm db:setup`).
set -e

if [ "${DB_BOOTSTRAP_ON_START:-true}" = "true" ]; then
  echo "[bootstrap] prisma migrate deploy"
  node_modules/.bin/prisma migrate deploy
  echo "[bootstrap] seed"
  node dist-bootstrap/prisma/seed.js
  echo "[bootstrap] embeddings"
  node dist-bootstrap/scripts/embed-dishes.js
else
  echo "[bootstrap] skipped (DB_BOOTSTRAP_ON_START=false)"
fi

exec node dist/main.js
