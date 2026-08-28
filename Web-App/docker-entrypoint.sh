#!/bin/sh
set -e

# Create data directories with correct ownership
# Verzeichnisse der neuen Ordnung. instructions/shared und part_images sind
# entfallen (siehe utils/appPaths.ts); vorhandene Altbestände zieht
# utils/migrateLayout.ts beim Start um, deshalb werden sie hier nicht mehr
# angelegt.
mkdir -p \
  /app/data/instructions \
  /app/data/uploads \
  /app/data/images/sets \
  /app/data/images/parts \
  /app/data/images/minifigs

# public/ gehört nicht mehr dazu: Bilder liegen jetzt unter data/images/
# (siehe utils/appPaths.ts). public/ ist damit wieder read-only Build-Inhalt.
chown -R brickinv:brickinv \
  /app/data

# Drop to brick user and start
# dist/server.js statt server.js: Der Build schreibt seit der Umstellung nach
# dist/ (siehe Dockerfile und .gitignore), damit Quelle und Erzeugnis nicht
# mehr im selben Verzeichnis stehen.
exec su-exec brickinv node dist/server.js
