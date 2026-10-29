-- Laufzeitzustand der Jobs bekommt eine eigene Tabelle; global_settings hält
-- danach nur noch Konfiguration (utils/laufzustand.ts).
CREATE TABLE laufzustand (
  schluessel   TEXT PRIMARY KEY,
  wert         TEXT NOT NULL DEFAULT '',
  aktualisiert TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO laufzustand (schluessel, wert, aktualisiert)
SELECT key, COALESCE(value, ''), COALESCE(updated_at, NOW())
  FROM global_settings
 WHERE starts_with(key, 'job_monitor_')
    OR key IN ('imgdl_pending_count', 'startup_status', 'imgredl_status', 'imgqueue_last_run',
               'rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync',
               'csv_sync_trigger', 'job_reschedule_trigger', 'instr_queue_trigger', 'instr_queue_block')
ON CONFLICT DO NOTHING;

DELETE FROM global_settings
 WHERE starts_with(key, 'job_monitor_')
    OR key IN ('imgdl_pending_count', 'startup_status', 'imgredl_status', 'imgqueue_last_run',
               'rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync',
               'csv_sync_trigger', 'job_reschedule_trigger', 'instr_queue_trigger', 'instr_queue_block');
