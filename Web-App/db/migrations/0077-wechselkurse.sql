-- Referenzkurse der EZB: wie viele Einheiten einer Währung ein Euro kostet.
-- Ein Kaufpreis in fremder Währung wird zum Kurs seines Kauftags in die
-- Anzeigewährung umgerechnet; fehlt der Tag (Wochenende, Feiertag), gilt der
-- nächstfrühere. EUR selbst steht nicht in der Tabelle, sein Kurs ist 1.
CREATE TABLE wechselkurse (
  tag       date    NOT NULL,
  waehrung  char(3) NOT NULL CHECK (waehrung ~ '^[A-Z]{3}$' AND waehrung <> 'EUR'),
  je_eur    numeric NOT NULL CHECK (je_eur > 0),
  PRIMARY KEY (waehrung, tag)
);

CREATE FUNCTION kurs_je_eur(w text, t date) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN upper(w) = 'EUR' THEN 1::numeric
              ELSE (SELECT k.je_eur FROM wechselkurse k
                     WHERE k.waehrung = upper(w) AND k.tag <= t
                     ORDER BY k.tag DESC LIMIT 1) END
$$;

-- Ein Betrag in einer anderen Währung; NULL, wenn ein Kurs fehlt.
CREATE FUNCTION in_waehrung(betrag numeric, von text, nach text, t date) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN betrag IS NULL THEN NULL
              WHEN upper(von) = upper(nach) THEN betrag
              ELSE round(betrag / kurs_je_eur(von, t) * kurs_je_eur(nach, t), 4) END
$$;
