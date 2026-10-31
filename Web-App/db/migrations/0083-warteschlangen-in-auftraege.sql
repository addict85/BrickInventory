-- Die eigenen Warteschlangen gehen in die Auftragstabelle auf; danach gibt es
-- sie nicht mehr. Offenes wird übernommen, Erledigtes nur, soweit es etwas
-- verhindert (eine Anleitung, die es nicht gab, wird nicht bei jedem Start
-- neu gesucht).

-- Anleitungen: je Set ein Auftrag 'anleitung'.
INSERT INTO auftraege (art, nutzlast, schluessel, status, max_versuche, faellig_ab, fehler, erstellt, aktualisiert)
SELECT 'anleitung', jsonb_build_object('set_number', set_number), 'anleitung:' || set_number,
       CASE status WHEN 'pending' THEN 'offen' WHEN 'done' THEN 'erledigt' ELSE 'fehler' END,
       3, NOW(), CASE WHEN status = 'failed' THEN 'aus der früheren Warteschlange übernommen' END,
       COALESCE(created_at, NOW()), COALESCE(updated_at, NOW())
  FROM instruction_queue
ON CONFLICT (schluessel) WHERE status = 'offen' DO NOTHING;
DROP TABLE instruction_queue;

-- Brickset-Wiedervorlage: je Set ein Auftrag 'brickset', fällig um 04:00 des
-- vorgemerkten Tages (die Uhrzeit setzt der Job-Prozess beim nächsten
-- Umstellen neu); `versuch` zählt die Wiedervorlagen weiter.
INSERT INTO auftraege (art, nutzlast, schluessel, max_versuche, faellig_ab, fehler, erstellt)
SELECT 'brickset', jsonb_build_object('set_number', set_number, 'versuch', GREATEST(attempts, 1)),
       'brickset:' || set_number, 3, retry_after + TIME '04:00', last_error, COALESCE(created_at, NOW())
  FROM brickset_retry_queue
ON CONFLICT (schluessel) WHERE status = 'offen' DO NOTHING;
DROP TABLE brickset_retry_queue;

-- PDF-Aufträge: Der Status stand doppelt (hier und im Auftrag). Laufende
-- bekommen ihren Schlüssel und die Schätzung; fertige und gescheiterte
-- bleiben als Auftrag bis zum Aufräumen abrufbar.
UPDATE auftraege a SET schluessel = 'pdf:' || p.id,
       fortschritt = jsonb_build_object('fehlendeBilder', p.fehlende_bilder, 'etaSekunden', p.eta_sekunden)
  FROM pdf_auftraege p
 WHERE a.art = 'pdf' AND a.status IN ('offen', 'laeuft') AND a.nutzlast->>'job_id' = p.id;
INSERT INTO auftraege (art, user_id, schluessel, status, fehler, faellig_ab, erstellt, aktualisiert)
SELECT 'pdf', p.user_id, 'pdf:' || p.id,
       CASE p.status WHEN 'done' THEN 'erledigt' ELSE 'fehler' END,
       CASE WHEN p.status = 'running' THEN 'beim Update unterbrochen' ELSE p.fehler END,
       NOW(), p.aktualisiert, p.aktualisiert
  FROM pdf_auftraege p
 WHERE NOT EXISTS (SELECT 1 FROM auftraege a WHERE a.schluessel = 'pdf:' || p.id);
DROP TABLE pdf_auftraege;

-- csv_import_jobs ist keine Warteschlange (die ist der Auftrag 'csv_import'),
-- sondern der Importstand je Konto, den auch der Wanted-Listen-Import zeigt:
-- Name nach dem, was die Tabelle hält.
-- Die Namen der Schranken bleiben: Ältere Installationen tragen andere.
ALTER TABLE csv_import_jobs RENAME TO import_stand;

-- Zustände der abgelösten Planer und Warteschlangen.
DELETE FROM laufzustand WHERE schluessel IN ('instr_queue_block', 'instr_queue_trigger');
