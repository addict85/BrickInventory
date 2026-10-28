-- Tageszähler der externen Dienste in eigener Tabelle statt als Werte in
-- global_settings: je Tag, Dienst und Konto eine Zeile (konto 0 = alle).
-- Je Konto, damit ein Konto das gemeinsame Tageskontingent nicht allein
-- verbrauchen kann.
CREATE TABLE IF NOT EXISTS api_aufrufe (
  tag    DATE    NOT NULL,
  api    TEXT    NOT NULL CHECK (api IN ('bricklink', 'rebrickable', 'brickset')),
  konto  INTEGER NOT NULL DEFAULT 0,
  anzahl INTEGER NOT NULL DEFAULT 0 CHECK (anzahl >= 0),
  PRIMARY KEY (tag, api, konto)
);

-- Den heutigen Stand übernehmen, damit ein Update mitten am Tag nicht von 0 zählt.
INSERT INTO api_aufrufe (tag, api, konto, anzahl)
SELECT d.value::date, substr(c.key, length('api_calls_') + 1), 0, c.value::int
  FROM global_settings c
  JOIN global_settings d ON d.key = 'api_calls_date_' || substr(c.key, length('api_calls_') + 1)
 WHERE c.key IN ('api_calls_bricklink', 'api_calls_rebrickable', 'api_calls_brickset')
   AND c.value ~ '^[0-9]+$' AND d.value ~ '^\d{4}-\d{2}-\d{2}$'
ON CONFLICT DO NOTHING;

DELETE FROM global_settings WHERE key LIKE 'api\_calls\_%';
