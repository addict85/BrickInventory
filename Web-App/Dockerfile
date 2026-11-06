# Node 26: Support bis 30.04.2029, ein Jahr länger als 24. Dieselbe Hauptversion
# steht in beiden FROM-Zeilen, in .github/workflows/web-ci.yml und in .nvmrc;
# test/build-tooling.test.js hält sie zusammen. Nach einem Wechsel einmal eine
# Vorschau erzeugen: Meldet das Protokoll den Jimp-Rückfall, fehlt sharp die
# Binärdatei für diese Fassung.
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS builder

WORKDIR /app

# Keine Build-Werkzeuge (python3/make/g++): Kein Paket baut aus C++-Quellen;
# sharp und esbuild laden fertige Binärdateien. Braucht eine neue Abhängigkeit
# doch node-gyp, scheitert `npm ci` mit „gyp ERR! find Python“ und
# `RUN apk add --no-cache python3 make g++` gehört zurück (test/dockerfile.test.js
# meldet das vorher an der Lockfile).

# Mit Lockfile, sonst löst jeder Bau die Abhängigkeiten neu auf.
COPY package.json package-lock.json ./
# scripts/ für die Bauschritte (build-ts, version, build-frontend).
COPY scripts/ ./scripts/
# npm ci bricht ab, wenn package.json und Lockfile auseinanderlaufen. Mit
# devDependencies, weil der Bau esbuild braucht (prune unten entfernt sie).
# Install-Skripte laufen nur für esbuild: Ein kompromittiertes Paket im Baum
# führte sonst beim Bau Code aus (test/dockerfile.test.js prüft die Liste).
RUN npm ci --ignore-scripts && npm rebuild esbuild

# ── TypeScript → JavaScript ────────────────────────────────────────────────────
# esbuild entfernt nur die Typen, Datei für Datei; geprüft wird in der CI
# (`npx tsc --noEmit`). Jeder Quellordner braucht hier ein COPY, sonst fehlt
# er in dist/ (dieselbe Liste wie SRC_DIRS in scripts/build-ts.js).
COPY server.ts ./
COPY db/     ./db/
COPY jobs/   ./jobs/
COPY src/    ./src/
COPY routes/ ./routes/
COPY clients/ ./clients/
COPY startup/ ./startup/
# Ausgabe nach dist/: Nur das geht ins Laufzeit-Image, keine .ts-Quelle.
# Die Version kommt als Build-Argument (docker-publish.yml), weil im Kontext
# kein .git liegt; ohne Argument steht „unbekannt“ in dist/version.json.
ARG APP_VERSION=
RUN APP_VERSION="$APP_VERSION" node scripts/build-ts.js --outdir dist

# Frontend: ein Bündel (scripts/build-frontend.js) statt vieler Skript-Abrufe.
# 00-theme-boot.js, pdfjs-boot.js und logviewer.js lädt die Seite einzeln;
# sie werden für sich minifiziert. Die Quellen im Repo bleiben lesbar.
COPY public/ ./public/
RUN node scripts/build-frontend.js \
 && for f in public/js/00-theme-boot.js public/js/pdfjs-boot.js public/js/logviewer.js; do \
      ./node_modules/.bin/esbuild "$f" --minify --charset=utf8 --outfile="$f.min" && mv "$f.min" "$f"; \
    done \
 && ./node_modules/.bin/esbuild public/styles.css --minify --charset=utf8 --outfile=public/styles.min.css \
 && mv public/styles.min.css public/styles.css

# devDependencies entfernen, bevor node_modules ins Laufzeit-Image geht; erst
# hier, weil esbuild bis eben gebraucht wurde.
RUN npm prune --omit=dev --ignore-scripts && npm cache clean --force

# ── Runtime Stage ──────────────────────────────────────────────────────────────
# Dieselbe Zeile wie im Build-Stage oben.
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797

WORKDIR /app

# su-exec gibt die Rechte ab. Feste Fassung (Alpine 3.24 des Basis-Images): Ein
# neues Basis-Image mit anderer Fassung scheitert hier sichtbar, statt still zu wechseln.
RUN apk add --no-cache su-exec=0.3-r0
# Zur Laufzeit startet nur `node`; npm, corepack und yarn des Basis-Images
# brächten fremde Pakete mit eigenen Lücken ins Image (Trivy).
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

RUN addgroup -S brickinv && adduser -S brickinv -G brickinv

# node_modules ohne devDependencies aus dem Build-Stage; ein zweites npm ci
# kostete einen weiteren Registry-Durchlauf für dieselben Pakete.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public/

COPY docker-entrypoint.sh schluessel-anlegen.sh ./
RUN chmod +x docker-entrypoint.sh

# ── App ───────────────────────────────────────────────────────────────────────
ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=384"
# Ein Prozess für Web und Jobs; compose.yaml teilt sie mit ROLLE=web und ROLLE=jobs.
ENV ROLLE=beides

# ── Datenbank ─────────────────────────────────────────────────────────────────
ENV PGHOST=postgres
ENV PGPORT=5432
ENV PGUSER=brickinventory
# Kein PGPASSWORD: Ein ENV steht in jeder Kopie des Images (docker inspect).
# compose.yaml reicht es als Datei herein (PGPASSWORD_FILE, ./geheimnisse/).
ENV PGDATABASE=brickinventory

# ── DB-Verbindungspool ────────────────────────────────────────────────────────
# PG_POOL_MAX ist bewusst nicht gesetzt: Die Vorgabe in db/database.ts (15 je
# Prozess) reicht für Web und Jobs. Wer sie ändert, setzt sie sichtbar in compose.yaml.
ENV PG_POOL_MIN=2
ENV PG_IDLE_MS=30000
ENV PG_CONN_MS=5000
ENV PG_STMT_MS=30000

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
