import type { DbSchnittstelle } from '../../../db/database';

/** Datenzugriff auf die PDF-Aufträge (Art 'pdf' der Auftragstabelle). */

export function pdfAuftragZeile(db: DbSchnittstelle, schluessel: string) {
  return db.get<{
    status: string;
    fehler: string | null;
    user_id: number | null;
    fortschritt: { fehlendeBilder?: number; etaSekunden?: number } | null;
  }>(
    `SELECT status, fehler, user_id, fortschritt FROM auftraege
      WHERE art = 'pdf' AND schluessel = $1 ORDER BY id DESC LIMIT 1`,
    [schluessel],
  );
}

export function zaehleLaufendePdf(db: DbSchnittstelle, uid: number, fristSek: number) {
  return db.get<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM auftraege
      WHERE art = 'pdf' AND user_id = $1 AND status IN ('offen', 'laeuft')
        AND erstellt > NOW() - make_interval(secs => $2)`,
    [uid, fristSek],
  );
}

export function loeschePdfAuftrag(db: DbSchnittstelle, schluessel: string) {
  return db.run(`DELETE FROM auftraege WHERE art = 'pdf' AND schluessel = $1 AND status <> 'laeuft'`, [schluessel]);
}

/** Fertige nach Ablauf der Frist; liefert die Schlüssel für das Löschen der Dateien. */
export function loescheAltePdfAuftraege(db: DbSchnittstelle, fristSek: number) {
  return db.all<{ id: string }>(
    `DELETE FROM auftraege WHERE art = 'pdf' AND status IN ('erledigt', 'fehler', 'abgebrochen')
        AND aktualisiert < NOW() - make_interval(secs => $1)
     RETURNING substr(schluessel, 5) AS id`,
    [fristSek],
  );
}

/** Teil- und Figurenbilder der Sets, die noch nicht lokal liegen. */
export function fehlendeKatalogbilder(db: DbSchnittstelle, setNummern: string[]) {
  return db.get<{ c: string | number }>(
    `SELECT (SELECT COUNT(*) FROM (SELECT DISTINCT part_number, color_id FROM set_parts_catalog
                WHERE set_number = ANY($1) AND image_url IS NOT NULL AND image_local IS NULL) p)
            + (SELECT COUNT(*) FROM (SELECT DISTINCT fig_number FROM set_minifigs_catalog
                WHERE set_number = ANY($1) AND image_url IS NOT NULL AND image_local IS NULL) f) AS c`,
    [setNummern],
  );
}
