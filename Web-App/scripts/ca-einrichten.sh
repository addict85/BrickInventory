#!/bin/sh
# Eine eigene Wurzel-CA für Caddy, die nur für BRICK_HOST gilt (Name
# Constraints): Die Wurzel kommt auf jedes Gerät, und ohne Einschränkung
# könnte ihr Schlüssel Zertifikate für jede Adresse ausstellen, der diese
# Geräte dann trauen. Caddy bekommt nur die Zwischenstelle samt Schlüssel; den
# Schlüssel der Wurzel behält dieses Skript nicht (oder legt ihn auf Wunsch
# an einen Ort ausserhalb des Servers). UPGRADE.md, Abschnitt 32.
#
#   sh scripts/ca-einrichten.sh [BRICK_HOST]
#
#   BRICK_HOST         Name oder IP-Adresse; ohne Angabe aus der Umgebung oder .env
#   CA_ORDNER          Ziel, Vorgabe ./caddy/ca (compose.yaml hängt ihn bei Caddy ein)
#   WURZEL_SCHLUESSEL  Pfad, unter dem der Schlüssel der Wurzel bleiben soll
#                      (USB-Stick, Passwort-Safe); leer = verwerfen
#   NEU=1              eine vorhandene CA ersetzen (alle Geräte brauchen dann
#                      die neue Wurzel, die App einen neuen QR-Code)
set -eu

HOST="${1:-${BRICK_HOST:-}}"
if [ -z "$HOST" ] && [ -f .env ]; then
  HOST=$(sed -n 's/^BRICK_HOST=//p' .env | tail -n 1 | tr -d '"'"'"' ')
fi
[ -n "$HOST" ] || { echo "[ca] BRICK_HOST fehlt (Argument, Umgebung oder .env)." >&2; exit 1; }
ORDNER="${CA_ORDNER:-./caddy/ca}"
WURZEL_SCHLUESSEL="${WURZEL_SCHLUESSEL:-}"
TAGE_WURZEL=3650
TAGE_ZWISCHEN=3649
command -v openssl >/dev/null || { echo "[ca] openssl fehlt." >&2; exit 1; }
# Caddy läuft im Container als root ohne Capabilities (compose.yaml) und liest
# deshalb nur Dateien, die root gehören.
if [ -z "${CA_ORDNER:-}" ] && [ "$(id -u)" != "0" ]; then
  echo "[ca] Mit sudo ausführen: Caddy liest ./caddy/ca nur, wenn root die Dateien gehören." >&2
  exit 1
fi

if [ -e "$ORDNER/root.crt" ] && [ "${NEU:-0}" != "1" ]; then
  echo "[ca] $ORDNER/root.crt gibt es schon; ersetzen nur mit NEU=1." >&2
  exit 1
fi

# Nur die eine Adresse: Ein Name erlaubt sich selbst und seine Unternamen,
# IP-Adressen sind dann ganz ausgeschlossen; eine IP-Adresse erlaubt nur
# sich, Namen nur unter .invalid (einem Namen, den es nie gibt).
case "$HOST" in
  *:*)       BEREICH="permitted;IP:$HOST/FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF,permitted;DNS:invalid" ;;
  *[!0-9.]*) BEREICH="permitted;DNS:$HOST,excluded;IP:0.0.0.0/0.0.0.0,excluded;IP:::/::" ;;
  *)         BEREICH="permitted;IP:$HOST/255.255.255.255,permitted;DNS:invalid" ;;
esac

umask 077
ARBEIT=$(mktemp -d)
trap 'rm -rf "$ARBEIT"' EXIT INT TERM

cat > "$ARBEIT/ext.cnf" <<EOF
[wurzel]
basicConstraints = critical, CA:TRUE, pathlen:1
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, $BEREICH

[zwischen]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, digitalSignature, keyCertSign, cRLSign
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
nameConstraints = critical, $BEREICH
EOF

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$ARBEIT/root.key" 2>/dev/null
openssl req -new -key "$ARBEIT/root.key" -subj "/CN=BrickInventory Wurzel ($HOST)" -out "$ARBEIT/root.csr"
openssl x509 -req -in "$ARBEIT/root.csr" -signkey "$ARBEIT/root.key" -sha256 -days "$TAGE_WURZEL" \
  -extfile "$ARBEIT/ext.cnf" -extensions wurzel -out "$ARBEIT/root.crt" 2>/dev/null
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$ARBEIT/zwischen.key" 2>/dev/null
openssl req -new -key "$ARBEIT/zwischen.key" -subj "/CN=BrickInventory Zwischenstelle ($HOST)" \
  -out "$ARBEIT/zwischen.csr"
openssl x509 -req -in "$ARBEIT/zwischen.csr" -CA "$ARBEIT/root.crt" -CAkey "$ARBEIT/root.key" \
  -CAcreateserial -sha256 -days "$TAGE_ZWISCHEN" -extfile "$ARBEIT/ext.cnf" -extensions zwischen \
  -out "$ARBEIT/zwischen.crt" 2>/dev/null
openssl verify -CAfile "$ARBEIT/root.crt" "$ARBEIT/zwischen.crt" >/dev/null

mkdir -p "$ORDNER"
# Die Kette mit der Wurzel: Caddy liefert sie aus, und die App pinnt die Wurzel.
cat "$ARBEIT/zwischen.crt" "$ARBEIT/root.crt" > "$ARBEIT/zwischen-kette.crt"
for f in root.crt zwischen.crt zwischen-kette.crt zwischen.key; do
  cp "$ARBEIT/$f" "$ORDNER/$f.neu"
done
chmod 644 "$ORDNER/root.crt.neu" "$ORDNER/zwischen.crt.neu" "$ORDNER/zwischen-kette.crt.neu"
chmod 600 "$ORDNER/zwischen.key.neu"
for f in root.crt zwischen.crt zwischen-kette.crt zwischen.key; do
  mv "$ORDNER/$f.neu" "$ORDNER/$f"
done

if [ -n "$WURZEL_SCHLUESSEL" ]; then
  cp "$ARBEIT/root.key" "$WURZEL_SCHLUESSEL"
  chmod 600 "$WURZEL_SCHLUESSEL"
  echo "[ca] Schlüssel der Wurzel unter $WURZEL_SCHLUESSEL — vom Server wegbringen."
else
  echo "[ca] Schlüssel der Wurzel verworfen. Eine neue Zwischenstelle (in $TAGE_ZWISCHEN Tagen) heisst dann: neue CA."
fi
FP=$(openssl x509 -in "$ORDNER/root.crt" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)
echo "[ca] Wurzel für $HOST in $ORDNER/root.crt, Fingerabdruck (fp) $FP"
# Diesen Wert zeigt ein Gerät beim Installieren an; er steht auch im Protokoll von Caddy.
echo "[ca] SHA-256 des Zertifikats zum Abgleich auf jedem Gerät: $(openssl x509 -in "$ORDNER/root.crt" -noout -fingerprint -sha256 | sed 's/^[^=]*=//')"
echo "[ca] Weiter: docker compose up -d caddy, dann die Wurzel auf die Geräte und die App neu verknüpfen."
