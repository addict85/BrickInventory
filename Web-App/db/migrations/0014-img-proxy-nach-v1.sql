-- Gespeicherte Bild-Adressen auf /api/v1/img-proxy umstellen.
--
-- ── Der Befund ──────────────────────────────────────────────────────────────
-- Der Bild-Proxy war nach der Zusammenlegung der API-Oberflächen die letzte
-- Adresse neben /api/v1 (Nachtrag 161). Aufgefallen ist sie erst, als die
-- zuständige Prüfung den ganzen Serverbaum durchsuchte statt nur server.ts —
-- angemeldet wird sie in routes/imgProxy.ts.
--
-- ── Warum das eine MIGRATION braucht und nicht nur eine Zeile Code ──────────
-- Diese Adresse wird GESPEICHERT, nicht nur gerufen: utils/images.ts baut sie
-- in `image_url`, und die Werte stehen so in den Tabellen. Wer nur die
-- bauende Stelle umstellt, hat danach zwei Formen in denselben Spalten —
-- genau die Bauart, gegen die dieser Baum sonst prüft.
--
-- Die alte Route bleibt trotzdem bedient (routes/imgProxy.ts): Installierte
-- App-Fassungen bauen die Adresse SELBST zusammen (ImageUrls.kt), und wer
-- nicht aktualisiert, bekäme sonst überhaupt keine Teilebilder mehr. Sie ist
-- damit eine Auslauf-Adresse, kein zweiter gleichrangiger Weg.
--
-- ── Warum LEFT(…) statt LIKE '%…%' ─────────────────────────────────────────
-- Die Adresse steht immer am ANFANG des Wertes (proxyImageUrl baut sie so).
-- Ein Muster mit führendem % könnte einen CDN-Link treffen, der die
-- Zeichenkette zufällig im Query-Teil trägt — und aus ihm eine kaputte
-- Adresse machen. Der Präfixvergleich kann das nicht.
--
-- Sieben Tabellen tragen image_url (aus db/schema.sql gelesen, nicht geraten).
UPDATE sets                 SET image_url = '/api/v1' || SUBSTRING(image_url FROM 5)
  WHERE LEFT(image_url, 15) = '/api/img-proxy?';
UPDATE parts                SET image_url = '/api/v1' || SUBSTRING(image_url FROM 5)
  WHERE LEFT(image_url, 15) = '/api/img-proxy?';
UPDATE minifigs             SET image_url = '/api/v1' || SUBSTRING(image_url FROM 5)
  WHERE LEFT(image_url, 15) = '/api/img-proxy?';
UPDATE set_catalog          SET image_url = '/api/v1' || SUBSTRING(image_url FROM 5)
  WHERE LEFT(image_url, 15) = '/api/img-proxy?';
UPDATE set_parts_catalog    SET image_url = '/api/v1' || SUBSTRING(image_url FROM 5)
  WHERE LEFT(image_url, 15) = '/api/img-proxy?';
UPDATE set_minifigs_catalog SET image_url = '/api/v1' || SUBSTRING(image_url FROM 5)
  WHERE LEFT(image_url, 15) = '/api/img-proxy?';
UPDATE catalog_cache        SET image_url = '/api/v1' || SUBSTRING(image_url FROM 5)
  WHERE LEFT(image_url, 15) = '/api/img-proxy?';
