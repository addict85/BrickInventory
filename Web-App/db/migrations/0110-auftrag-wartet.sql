-- Ein verschobener Auftrag (Kontingent erschöpft, Gegenseite drosselt) ist nicht
-- gescheitert, er wartet. Die Verwaltung muss das unterscheiden können, ohne den
-- Grund aus dem Fehlertext zu raten.
ALTER TABLE auftraege ADD COLUMN wartet boolean NOT NULL DEFAULT false;

-- „Fehlende Preise holen“ hatte je Postenliste einen eigenen Schlüssel; jetzt ist
-- es einer je Konto und Währung. Die alten offenen stellt die nächste Bewertung
-- vollständig neu ein.
DELETE FROM auftraege
 WHERE art = 'preise_nachladen' AND status = 'offen'
   AND schluessel IS DISTINCT FROM 'preise_nachladen:' || (nutzlast->>'user_id') || ':' || (nutzlast->>'waehrung');
