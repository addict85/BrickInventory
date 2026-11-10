-- Gesetzt in derselben Transaktion wie die Wirkung der ersten Anfrage. Stürzt
-- der Server zwischen COMMIT und dem Merken der Antwort ab, darf die
-- Wiederholung nicht nach der Frist ein zweites Mal wirken.
ALTER TABLE idempotenz ADD COLUMN wirkung boolean NOT NULL DEFAULT false;
