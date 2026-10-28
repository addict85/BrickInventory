-- schema_migrations hatte zwei Formen: (id, name, run_at) aus dem früheren
-- schema.sql und (name, applied_at) aus db/migrate.ts. Jetzt eine.
-- schema_meta war der Vermerk für den alten Erststart über initSchema();
-- seit db/basis.sql gibt es ihn nicht mehr.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'schema_migrations' AND column_name = 'id') THEN
    ALTER TABLE schema_migrations DROP CONSTRAINT IF EXISTS schema_migrations_pkey;
    ALTER TABLE schema_migrations DROP CONSTRAINT IF EXISTS schema_migrations_name_key;
    ALTER TABLE schema_migrations DROP COLUMN id;
    ALTER TABLE schema_migrations ADD PRIMARY KEY (name);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'schema_migrations' AND column_name = 'run_at') THEN
    ALTER TABLE schema_migrations RENAME COLUMN run_at TO applied_at;
  END IF;
END $$;
UPDATE schema_migrations SET applied_at = NOW() WHERE applied_at IS NULL;
ALTER TABLE schema_migrations ALTER COLUMN applied_at SET DEFAULT NOW(), ALTER COLUMN applied_at SET NOT NULL;

DROP TABLE IF EXISTS schema_meta;
