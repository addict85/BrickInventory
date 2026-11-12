#!/bin/sh
# Übernimmt das App-Image und das Caddy-Image nur als signaturgeprüfte
# Digests: Ein Tag lässt sich bei Docker Hub umhängen, ein Digest nicht.
# compose.yaml startet ohne BRICK_IMAGE und CADDY_IMAGE nicht. UPGRADE.md,
# Abschnitte 42 und 51.
#
#   sh scripts/image-pruefen.sh     (im Ordner mit compose.yaml; Tag aus BRICK_TAG, Vorgabe latest)
#
# Erstinstallation und jedes Update: dieses Skript, danach `docker compose up -d`.
set -eu

ENV_DATEI="${ENV_DATEI:-.env}"
REPO=addict85/brickinventory
CADDY_REPO=addict85/brickinventory-caddy
IDENTITAET='https://github.com/addict85/BrickInventory/.github/workflows/docker-publish.yml@refs/heads/main'
AUSSTELLER='https://token.actions.githubusercontent.com'

aus_env() {
  [ -f "$ENV_DATEI" ] || return 0
  sed -n "s/^$1=//p" "$ENV_DATEI" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

tag=$(aus_env BRICK_TAG)
tag="${tag:-latest}"
if ! command -v cosign >/dev/null 2>&1; then
  echo "[image] cosign fehlt. Installieren (Paketverwaltung oder https://github.com/sigstore/cosign/releases)," >&2
  echo "        dann erneut aufrufen. Ohne Prüfung: UPGRADE.md#image-digest." >&2
  exit 1
fi

# cosign löst den Tag selbst auf und nennt den geprüften Digest; übernommen
# wird genau dieser, keine zweite Auflösung, die inzwischen anders lauten könnte.
pruefe() {
  echo "[image] prüfe die Signatur von $1:$tag …" >&2
  if ! ausgabe=$(cosign verify "$1:$tag" --certificate-identity "$IDENTITAET" --certificate-oidc-issuer "$AUSSTELLER"); then
    echo "[image] Signaturprüfung für $1:$tag fehlgeschlagen — nichts geändert." >&2
    return 1
  fi
  digest=$(printf '%s\n' "$ausgabe" | grep -o '"docker-manifest-digest": *"sha256:[0-9a-f]\{64\}"' \
    | sed 's/.*"\(sha256:[0-9a-f]*\)"$/\1/' | sort -u)
  if [ "$(printf '%s\n' "$digest" | grep -c '^sha256:')" != 1 ]; then
    echo "[image] $1: Erwartet war genau ein geprüfter Digest, gefunden: ${digest:-keiner} — nichts geändert." >&2
    return 1
  fi
  printf '%s@%s\n' "$1" "$digest"
}

# Beide zuerst prüfen, dann beide eintragen: kein halber Stand in .env.
app=$(pruefe "$REPO") || exit 1
caddy=$(pruefe "$CADDY_REPO") || exit 1

# Über cat statt mv: .env behält Eigentümer und Rechte.
{ [ -f "$ENV_DATEI" ] && grep -v -e '^BRICK_IMAGE=' -e '^CADDY_IMAGE=' "$ENV_DATEI" || true
  echo "BRICK_IMAGE=$app"; echo "CADDY_IMAGE=$caddy"; } > "$ENV_DATEI.neu"
cat "$ENV_DATEI.neu" > "$ENV_DATEI"
rm -f "$ENV_DATEI.neu"
echo "[image] geprüft und in $ENV_DATEI eingetragen: BRICK_IMAGE=$app"
echo "[image] geprüft und in $ENV_DATEI eingetragen: CADDY_IMAGE=$caddy"
docker compose pull schluessel daten-rechte migration app jobs caddy-rechte caddy
echo "[image] fertig. Starten oder aktualisieren: docker compose up -d"
