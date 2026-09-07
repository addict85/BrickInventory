-- ── Eine WAHLBARE, feste Laufzeit fuer QR-Zugaenge ──────────────────────────
--
-- Marcos Wunsch: „Wie waere es, wenn man fuer die Tokens einstellen kann, wie
-- lange sie gueltig sein sollen — z.B. 1 Monat, 2 Monate, 6 Monate, 12 Monate.
-- Pro QR-Code soll das der User definieren koennen."
--
-- ── Warum zwei Spalten und nicht eine ───────────────────────────────────────
--
-- api_tokens.expires_at traegt bereits eine Frist, aber eine GLEITENDE:
-- `sliding = TRUE`, und _touchLastUsed() schiebt sie bei jeder Benutzung um
-- TOKEN_IDLE_DAYS nach vorn. Ihre Bedeutung ist „so lange UNGENUTZT" — ein
-- Telefon, das taeglich synchronisiert, laeuft damit nie ab.
--
-- Die neue Frist bedeutet etwas anderes: „so lange ueberhaupt", unabhaengig
-- von der Benutzung. Beides in eine Spalte zu legen hiesse, eine der beiden
-- Bedeutungen zu verlieren:
--
--   * Das feste Datum in expires_at UND sliding = TRUE: Jede Benutzung
--     verlaengert es — die Wahl waere wirkungslos.
--   * Das feste Datum in expires_at UND sliding = FALSE: Die Gleitfrist
--     entfaellt. Ein Telefon, das nach zwei Wochen verloren geht, behaelt
--     dann noch elfeinhalb Monate Zugriff, obwohl niemand es benutzt.
--
-- Mit zwei Spalten gilt, was frueher eintritt: die Gleitfrist ODER der feste
-- Termin. Genau das ist die Zusage — „12 Monate, aber wenn 90 Tage lang
-- niemand das Geraet anfasst, vorher".
--
-- NULL heisst „keine feste Frist" und ist der Bestand: Jede vorhandene Zeile
-- verhaelt sich unveraendert weiter.
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS hard_expires_at TIMESTAMPTZ;

-- Der Aufraeumjob und validateToken() fragen nach dieser Spalte; ohne Index
-- liest purgeExpiredTokens() dafuer die ganze Tabelle. Teilindex, weil die
-- ueberwaeltigende Mehrheit der Zeilen NULL traegt.
CREATE INDEX IF NOT EXISTS idx_api_tokens_hard ON api_tokens(hard_expires_at)
  WHERE hard_expires_at IS NOT NULL;

-- ── Die Wahl reist MIT DER NONCE, nicht mit der Einloese-Anfrage ────────────
--
-- Das ist der sicherheitsrelevante Teil und der Grund, warum die Spalte hier
-- steht und nicht bloss ein Feld im Rumpf von POST /qr-login ist:
--
-- /qr-login ist UNANGEMELDET erreichbar — es ist ja gerade der Weg, auf dem
-- sich ein Geraet erstmals ausweist. Duerfte das einloesende Geraet seine
-- eigene Laufzeit in die Anfrage schreiben, koennte jeder, der einen QR-Code
-- abfotografiert oder ueber die Schulter scannt, sich die laengstmoegliche
-- aussuchen. Die Wahl trifft deshalb die ANGEMELDETE Sitzung beim Erzeugen des
-- Codes; sie liegt hier, und /qr-login liest sie nur ab.
--
-- NULL = keine feste Frist (es bleibt bei der Gleitfrist), damit aeltere
-- Zeilen und aeltere Clients sich unveraendert verhalten.
ALTER TABLE qr_login_tokens ADD COLUMN IF NOT EXISTS token_days INTEGER;
