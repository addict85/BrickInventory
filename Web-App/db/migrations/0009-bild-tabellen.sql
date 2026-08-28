-- Tabellen für den Bild-Hintergrundjob und den Merker fehlender Bilder.
--
-- ── Warum als Migration und nicht in initSchema() ───────────────────────────
-- Marcos Befund: `relation "image_wanted" does not exist` — auf einem Server,
-- der die aktuelle App-Version fährt.
--
-- Ich hatte die Tabellen am Ende von initSchema() angelegt. Die läuft aber nur,
-- wenn sich die App-Version geändert hat (schema_meta), und der Aufruf stand
-- hinter einem `.catch(...)`, das Fehler nur protokolliert. Schlug er beim
-- ersten Start einer Version fehl, wurde die Version trotzdem als „angewandt"
-- vermerkt — und danach nie wieder versucht. Ein einziger stiller Fehlschlag
-- schaltete den Bild-Job dauerhaft ab.
--
-- Nummerierte Migrationen laufen IMMER und werden einzeln vermerkt. Genau
-- dafür gibt es sie; ich hatte den vorgesehenen Weg schlicht nicht benutzt.

-- Notizen: „dieses Bild wurde über den Proxy gebraucht" (jobs/imageQueue.ts).
CREATE TABLE IF NOT EXISTS image_wanted (
  url          TEXT PRIMARY KEY,
  set_number   TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bilder, die es beim CDN nicht gibt, und Vorschauen, die nicht erzeugt werden
-- können (utils/imageMisses.ts). Ohne diese Tabelle wird beides bei jedem
-- Ansehen erneut versucht.
CREATE TABLE IF NOT EXISTS image_misses (
  cache_key  TEXT PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
