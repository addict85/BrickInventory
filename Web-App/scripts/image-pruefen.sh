#!/bin/sh
# Übernimmt das App-Image nur als signaturgeprüften Digest: Ein Tag lässt sich
# bei Docker Hub umhängen, ein Digest nicht. compose.yaml startet ohne
# BRICK_IMAGE nicht. UPGRADE.md, Abschnitt 42.
#
#   sh scripts/image-pruefen.sh     (im Ordner mit compose.yaml; Tag aus BRICK_TAG, Vorgabe latest)
#
# Erstinstallation und jedes Update: dieses Skript, danach `docker compose up -d`.
set -eu

ENV_DATEI="${ENV_DATEI:-.env}"
REPO=addict85/brickinventory
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
  echo "        dann erneut aufrufen. Ohne Prüfung: UPGRADE.md, Abschnitt 42." >&2
  exit 1
fi

# cosign löst den Tag selbst auf und nennt den geprüften Digest; übernommen
# wird genau dieser, keine zweite Auflösung, die inzwischen anders lauten könnte.
echo "[image] prüfe die Signatur von $REPO:$tag …"
if ! ausgabe=$(cosign verify "$REPO:$tag" --certificate-identity "$IDENTITAET" --certificate-oidc-issuer "$AUSSTELLER"); then
  echo "[image] Signaturprüfung für $REPO:$tag fehlgeschlagen — nichts geändert." >&2
  exit 1
fi
digest=$(printf '%s\n' "$ausgabe" | grep -o '"docker-manifest-digest": *"sha256:[0-9a-f]\{64\}"' \
  | sed 's/.*"\(sha256:[0-9a-f]*\)"$/\1/' | sort -u)
if [ "$(printf '%s\n' "$digest" | grep -c '^sha256:')" != 1 ]; then
  echo "[image] Erwartet war genau ein geprüfter Digest, gefunden: ${digest:-keiner} — nichts geändert." >&2
  exit 1
fi

# Über cat statt mv: .env behält Eigentümer und Rechte.
zeile="BRICK_IMAGE=$REPO@$digest"
{ [ -f "$ENV_DATEI" ] && grep -v '^BRICK_IMAGE=' "$ENV_DATEI" || true; echo "$zeile"; } > "$ENV_DATEI.neu"
cat "$ENV_DATEI.neu" > "$ENV_DATEI"
rm -f "$ENV_DATEI.neu"
echo "[image] geprüft und in $ENV_DATEI eingetragen: $zeile"
docker compose pull schluessel daten-rechte migration app jobs
echo "[image] fertig. Starten oder aktualisieren: docker compose up -d"
