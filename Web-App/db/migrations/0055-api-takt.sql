-- Gemeinsamer Takt je fremder Schnittstelle, über alle Prozesse hinweg.
-- Jeder Web-Worker und der Hintergrundprozess hatten eigene Drosseln; ihre
-- Summe lag über dem, was Rebrickable erlaubt. Eine Zeile je Schnittstelle
-- hält den nächsten freien Zeitpunkt, reserviert wird atomar per UPDATE.
CREATE TABLE IF NOT EXISTS api_takt (
  api       TEXT PRIMARY KEY,
  naechster TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
