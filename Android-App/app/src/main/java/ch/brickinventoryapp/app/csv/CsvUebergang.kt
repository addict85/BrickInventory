package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.model.fach.Laufstatus
/**
 * Was folgt aus einer CSV-Statusmeldung? Getrennt von CsvImportKoordinator, der
 * handelt: Die Entscheidung braucht weder Dienst noch Zeit und lässt sich so als
 * Tabelle prüfen (CsvStatusReloadTest).
 */
internal enum class CsvFolge {
    /** Ein Import hat gerade begonnen — der Vordergrunddienst muss anlaufen. */
    DIENST_STARTEN,

    /** Ein laufender Import ist fertig geworden — Daten einmal neu laden. */
    NACHLADEN,

    /** Der Import ist gescheitert — Banner kurz zeigen, dann aufräumen. */
    FEHLER_AUFRAEUMEN,

    /** Nichts zu tun: kein Übergang, nur eine Wiederholung des Zustands. */
    NICHTS
}

/**
 * Läuft laut dieser Meldung gerade ein Import?
 *
 * `pending` zählt dazu: Der Auftrag ist angenommen, der Nutzer soll das Banner
 * schon sehen und der Dienst schon laufen — sonst wirkt die App zwischen
 * Annahme und erster Zeile eingefroren.
 */
internal fun importLaeuft(status: Laufstatus?): Boolean = status?.laeuft == true

/**
 * Die eigentliche Regel: Nachgeladen wird beim Übergang von „läuft“ zu „fertig“, nicht in
 * jedem Zustand „fertig“.
 */
internal fun csvFolge(warVorherAktiv: Boolean, status: Laufstatus?): CsvFolge = when {
    // Läuft: Dienst nur beim Anlaufen starten, nicht bei jeder Fortschrittszeile.
    importLaeuft(status) -> if (warVorherAktiv) CsvFolge.NICHTS else CsvFolge.DIENST_STARTEN

    // Ein Fehler wird gemeldet, solange er ansteht — hier ist das Aufräumen
    // gewollt idempotent und nicht an den Übergang gebunden.
    status == Laufstatus.FEHLER -> CsvFolge.FEHLER_AUFRAEUMEN

    status == null -> CsvFolge.NICHTS

    // Fertig — aber nur nachladen, wenn vorher wirklich etwas lief.
    warVorherAktiv -> CsvFolge.NACHLADEN

    else -> CsvFolge.NICHTS
}
