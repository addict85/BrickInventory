package ch.brickinventoryapp.ui

/**
 * Was folgt aus einer CSV-Statusmeldung? Getrennt von `handleCsvStatus()`
 * (AppViewModel), weil die Entscheidung weder `Context` noch `viewModelScope`
 * braucht — nur die Ausführung. So lässt sie sich ausführen statt nur im Quelltext
 * lesen. `handleCsvStatus()` bleibt die Stelle, die handelt; hier steht, was zu
 * tun ist.
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
internal fun importLaeuft(status: String?): Boolean =
    status == "running" || status == "pending"

/**
 * Die eigentliche Regel: Nachgeladen wird beim Übergang von „läuft“ zu „fertig“,
 * nicht in jedem Zustand „fertig“. Der SSE-Strom meldet den Importstatus
 * fortlaufend, auch lange nach dem Ende; eine Zustandsbedingung lüde alle paar
 * Sekunden neu und ersetzte die Galerie durch Seite 1 — die Liste spränge beim
 * Scrollen zurück. Ohne den vorherigen Zustand ist „gerade fertig geworden“ nicht
 * von „seit Stunden fertig“ zu unterscheiden.
 *
 * @param warVorherAktiv Lief vor dieser Meldung ein Import? Muss der Zustand vor
 *         dem Überschreiben sein — danach gelesen ist er immer der neue.
 * @param status Der `status` der Meldung; `null`, wenn der Server keinen geschickt
 *         hat. Aus `null` folgt nie ein Nachladen: Eine Meldung ohne Zustand ist
 *         kein Abschluss, sondern eine unvollständige Meldung.
 */
internal fun csvFolge(warVorherAktiv: Boolean, status: String?): CsvFolge = when {
    // Läuft: Dienst nur beim Anlaufen starten, nicht bei jeder Fortschrittszeile.
    importLaeuft(status) -> if (warVorherAktiv) CsvFolge.NICHTS else CsvFolge.DIENST_STARTEN

    // Ein Fehler wird gemeldet, solange er ansteht — hier ist das Aufräumen
    // gewollt idempotent und nicht an den Übergang gebunden.
    status == "error" -> CsvFolge.FEHLER_AUFRAEUMEN

    status == null -> CsvFolge.NICHTS

    // Fertig — aber nur nachladen, wenn vorher wirklich etwas lief.
    warVorherAktiv -> CsvFolge.NACHLADEN

    else -> CsvFolge.NICHTS
}
