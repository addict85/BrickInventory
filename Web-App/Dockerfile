# ── Build Stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# KEINE Build-Werkzeuge (python3/make/g++).
#
# Sie standen hier als Vorsorge für node-gyp: Ein Paket mit nativer Erweiterung
# würde beim Installieren aus C++-Quellen bauen, und auf Alpine ist nichts
# davon vorinstalliert — npm ci bricht dann mit einer schwer lesbaren Meldung ab.
#
# Im aktuellen Abhängigkeitsbaum baut nichts: keine einzige binding.gyp, und die
# einzigen Pakete mit Install-Skript sind esbuild (lädt eine fertige Binärdatei
# für die Plattform) und fsevents (nur macOS, auf Linux gar nicht installiert).
# Die üblichen Verdächtigen liegen alle in der reinen JavaScript-Variante vor:
# bcryptjs (nicht bcrypt), pg ohne pg-native, pdfkit.
#
# ── Ausnahme: sharp (Nachtrag 118) ───────────────────────────────────────────
# sharp bringt libvips als NATIVE Bibliothek mit — baut aber nicht aus Quellen,
# sondern lädt eine fertige Binärdatei für Plattform und C-Bibliothek
# (linux-x64-musl, linux-arm64-musl für dieses Alpine-Image). node-gyp und
# damit python3/make/g++ werden weiterhin nicht gebraucht.
#
# Sollte für eine Plattform kein Paket bereitstehen, bleibt der Server
# lauffähig: routes/thumbs.ts fällt dann auf Jimp zurück und schreibt eine
# Warnung ins Log. Deshalb ist jimp weiterhin eine Abhängigkeit, obwohl es im
# Normalbetrieb nicht mehr benutzt wird.
#
# WICHTIG: `npm ci` läuft hier OHNE --ignore-scripts — sonst lädt sharp seine
# Binärdatei nicht, und jede Vorschau liefe still über den langsamen Rückfall.
#
# Kommt später eine Abhängigkeit dazu, die doch kompiliert, scheitert `npm ci`
# hier mit „gyp ERR! find Python" — dann gehört die Zeile
#   RUN apk add --no-cache python3 make g++
# zurück. Sie kostet rund 200 MB Bauzeit-Ballast und landet nicht im
# Laufzeit-Image (eigenes Stage weiter unten), aber ohne Nutzen soll sie nicht
# bei jedem Build ohne Cache heruntergeladen werden.

# package-lock.json MUSS mitkopiert werden.
#
# VORHER stand hier nur `COPY package.json ./` plus `npm install`. Die Lockfile
# lag zwar im Repo, wurde aber nie ins Build-Stage übernommen — npm hat sie
# folglich ignoriert und bei JEDEM Rebuild die zum Zeitpunkt des Builds neuesten
# passenden Versionen aufgelöst. Zwei Builds desselben Commits konnten damit
# unterschiedliche Abhängigkeiten enthalten; ein Fehler aus einem transitiven
# Update wäre nicht reproduzierbar gewesen.
COPY package.json package-lock.json ./
# scripts/ vor der Installation kopieren, damit der postinstall-Bump das Skript findet
COPY scripts/ ./scripts/
# npm ci statt npm install: installiert exakt die Lockfile und bricht ab, wenn
# package.json und Lockfile auseinanderlaufen — statt die Lockfile stillschweigend
# umzuschreiben.
#
# MIT devDependencies: Das Build-Stage braucht esbuild (scripts/build-ts.js und
# build-frontend.js). Mit --omit=dev fiele es weg und die Skripte müssten es per
# npx aus dem Netz ziehen — langsam und vom Registry-Zustand abhängig. Ins
# Laufzeit-Image wandern die devDependencies trotzdem nicht: weiter unten
# entfernt `npm prune --omit=dev` sie wieder, bevor node_modules übernommen wird.
RUN npm ci

# ── TypeScript → JavaScript ────────────────────────────────────────────────────
# server.ts, db/, utils/, routes/ und jobs/ werden von esbuild pro Datei
# (kein Bundle) nach .js transpiliert. Nur public/ bleibt JavaScript.
# Kein tsc-Build nötig: Typprüfung läuft separat via `npm run typecheck`;
# esbuild strippt hier nur die Typen (schnell, deterministisch).
COPY server.ts ./
COPY db/     ./db/
COPY jobs/   ./jobs/
COPY utils/  ./utils/
COPY routes/ ./routes/
# clients/ seit Nachtrag 126 (rebrickable, brickset — API-Clients ohne Routen).
# Fehlt das COPY hier, entsteht kein dist/clients/ und der Server findet beim
# Start keinen einzigen dieser Importe. Dieselbe Falle wie bei SRC_DIRS in
# scripts/build-ts.js.
COPY clients/ ./clients/
# startup/ seit Nachtrag 134 — dieselbe Falle wie bei clients/ und jobs/.
COPY startup/ ./startup/
# Ausgabe nach dist/ statt neben die Quellen.
#
# VORHER wurde in-place gebaut und die .ts danach per
# `rm -f server.ts db/*.ts utils/*.ts routes/*.ts` gelöscht — was weder
# routes/api_v1/ (Unterverzeichnis, vom Glob nicht erfasst) noch jobs/ (fehlte
# ganz) erwischte; deren .ts landeten im Laufzeit-Image. Mit einem eigenen
# Ausgabeverzeichnis stellt sich die Frage nicht mehr: Ins Runtime-Stage geht
# nur dist/, die Quellen bleiben im Build-Stage zurück.
RUN node scripts/build-ts.js --outdir dist

# Frontend minifizieren: js/*.js, i18n.js + styles.css werden im Build-Stage komprimiert
# (~50-60% kleiner vor gzip). Die Quelldateien im Repo bleiben lesbar.
COPY public/ ./public/
# Version stempeln, nachdem public/ vorhanden ist: aktualisiert package.json,
# die Cache-Busting-Query (?v=…) in index.html und den Build-Text. Dadurch
# entspricht die Version dem Build-Zeitpunkt (YYYY.MM.DD.HHMM).
RUN node scripts/bump-version.js
# Frontend bündeln statt Datei für Datei zu minifizieren.
#
# VORHER lieferte index.html zwölf einzelne <script>-Tags aus (i18n.js +
# 01-core … 11-actions) — zwölf Roundtrips für zusammen ~333 KB. Jetzt hängt
# scripts/build-frontend.js sie in exakt derselben Reihenfolge aneinander und
# minifiziert das Ergebnis zu einer Datei (~218 KB, danach noch gzip).
# Bewusst Verkettung und kein `esbuild --bundle`: Die Dateien teilen sich einen
# globalen Namensraum, ein Modul-Bundler würde die gegenseitigen Zugriffe
# zerreissen.
#
# 00-theme-boot.js, pdfjs-boot.js (ES-Modul) und logviewer.js (zur Laufzeit
# nachgeladen) bleiben einzeln und werden hier separat minifiziert.
# Direkt node_modules/.bin/esbuild statt npx: npx kostet pro Aufruf mehrere
# hundert Millisekunden Auflösung, und esbuild liegt nach `npm ci` ohnehin
# lokal. Dieselbe Umstellung wie in scripts/build-*.js.
RUN node scripts/build-frontend.js \
 && for f in public/js/00-theme-boot.js public/js/pdfjs-boot.js public/js/logviewer.js; do \
      ./node_modules/.bin/esbuild "$f" --minify --charset=utf8 --outfile="$f.min" && mv "$f.min" "$f"; \
    done \
 && ./node_modules/.bin/esbuild public/styles.css --minify --charset=utf8 --outfile=public/styles.min.css \
 && mv public/styles.min.css public/styles.css

# devDependencies entfernen, BEVOR node_modules ins Laufzeit-Image geht.
#
# Muss nach allen Build-Schritten stehen: esbuild wird bis hierher gebraucht.
# --ignore-scripts, weil prune sonst erneut den postinstall-Hook auslöst; der
# Versionsstempel ist zu diesem Zeitpunkt längst gesetzt.
RUN npm prune --omit=dev --ignore-scripts && npm cache clean --force

# ── Runtime Stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# su-exec for privilege dropping
RUN apk add --no-cache su-exec

RUN addgroup -S brickinv && adduser -S brickinv -G brickinv

# node_modules aus dem Build-Stage — dort bereits per `npm prune --omit=dev`
# bereinigt (siehe oben). Damit liegen esbuild, typescript, jsdom und tsx NICHT
# im Laufzeit-Image.
#
# Ein zweites `npm ci --omit=dev` an dieser Stelle wäre der naheliegende Weg
# gewesen und war der erste Versuch — er schlägt fehl: `npm ci` führt den
# postinstall-Hook aus (scripts/bump-version.js), und scripts/ wird in dieses
# Stage nie kopiert. Selbst mit --ignore-scripts kostete es einen zweiten
# vollständigen Registry-Durchlauf: auf schwacher Hardware rund 45 Sekunden für
# Pakete, die eine Stage weiter oben schon installiert sind.
COPY --from=builder /app/node_modules ./node_modules
# Der komplette transpilierte Baum in einem Rutsch: dist/server.js, dist/db/,
# dist/routes/ (inkl. api_v1/), dist/utils/ und dist/jobs/. Ein einziges COPY
# statt fünf — und keine Chance mehr, ein Verzeichnis zu vergessen.
COPY --from=builder /app/dist ./dist/
# package.json aus dem Build-Stage übernehmen (enthält die gestempelte Version)
COPY --from=builder /app/package.json ./package.json
# public/ kommt minifiziert aus dem Build-Stage
COPY --from=builder /app/public ./public/

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# ── App ───────────────────────────────────────────────────────────────────────
ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=384"
# Workers: 0 = auto-detect CPU count (recommended). Set to 1 to disable clustering.
ENV WEB_WORKERS=0

# ── Datenbank ─────────────────────────────────────────────────────────────────
ENV PGHOST=postgres
ENV PGPORT=5432
ENV PGUSER=brickinventory
ENV PGPASSWORD=brickinventory_secret
ENV PGDATABASE=brickinventory

# ── DB-Verbindungspool ────────────────────────────────────────────────────────
# PG_POOL_MAX ist bewusst NICHT mehr gesetzt.
#
# VORHER stand hier 20 — und überschrieb damit die Berechnung in
# db/database.ts, die max. 15 pro Worker und höchstens 80 insgesamt vorsieht.
# Auf einem Achtkerner (WEB_WORKERS=0 → 8 Worker) ergab die Vorgabe
# 8 × 20 = 160 gleichzeitige Verbindungen; Postgres' Standard liegt bei 100.
# Die sorgfältige Formel im Code war damit wirkungslos.
#
# Ohne die Variable rechnet die App selbst: min(15, 80 / Anzahl Worker).
# Wer sie doch braucht, setzt sie in compose.yaml — dann bewusst und sichtbar.
ENV PG_POOL_MIN=2
ENV PG_IDLE_MS=30000
ENV PG_CONN_MS=5000
ENV PG_STMT_MS=30000

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
