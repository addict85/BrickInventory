package ch.brickinventoryapp.ui

/**
 * Was folgt aus einer CSV-Statusmeldung?
 *
 * ── Warum das eine eigene Datei ist (Nachtrag 110, Zuschnitt aus 117) ────────
 * Die Regel dahinter ist in `MainViewModel.handleCsvStatus()` entstanden und
 * war dort nur durch Quelltext-Lesen prüfbar: `CsvStatusReloadTest` suchte
 * nach der Zeichenfolge `if (!running && warVorherAktiv`. Das hält die
 * FORMULIERUNG fest, nicht das Verhalten — eine gleichwertige Umschreibung
 * bricht den Test, eine gleich aussehende Verschlechterung nicht.
 *
 * Ausgeführt werden konnte die Regel nicht, weil sie in einer Methode steckte,
 * die einen `Context` braucht (Dienst starten, Texte holen) und einen
 * `viewModelScope`. Beides braucht die ENTSCHEIDUNG nicht — nur die Ausführung
 * braucht es. Also derselbe Schnitt wie bei [fehlerTextId]: Was schwer prüfbar
 * ist, ist meistens nicht zu kompliziert, sondern nur mit etwas verwoben, das
 * es nicht braucht.
 *
 * `handleCsvStatus()` bleibt die Stelle, die HANDELT; hier steht nur, WAS zu
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
 * Die eigentliche Regel aus Nachtrag 110.
 *
 * Marcos Befund: „In der Galerie springt die Liste beim Scrollen zurück — immer
 * auf dieselbe Zeile." Sein Protokoll zeigte es unmissverständlich:
 *
 *     Seite 2: 60 empfangen, Liste  60 -> 120
 *     Seite 3: 60 empfangen, Liste 120 -> 180
 *     Seite 4: 60 empfangen, Liste 180 -> 240
 *     Seite 2: 60 empfangen, Liste  60 -> 120     ← zurück auf Anfang
 *
 * Ursache: Der SSE-Strom meldet den Importstatus fortlaufend, auch lange nach
 * dem Ende. Die Bedingung fragte nur „läuft gerade nicht und ist kein Fehler" —
 * das trifft auf JEDE Meldung eines abgeschlossenen Imports zu. Also lief das
 * Nachladen alle paar Sekunden erneut und ersetzte die ganze Galerie durch
 * Seite 1.
 *
 * Ein Abschluss ist ein ÜBERGANG, kein Zustand. Deshalb nimmt diese Funktion
 * [warVorherAktiv] entgegen: Ohne den vorherigen Zustand ist „gerade fertig
 * geworden" von „seit Stunden fertig" nicht zu unterscheiden. Dieselbe
 * Verwechslung wie beim Takt der Anleitungs-Warteschlange (Manager-Nachtrag
 * 142) und beim Bild-Job (217).
 *
 * @param warVorherAktiv Lief vor DIESER Meldung ein Import? Muss der Zustand
 *   vor dem Überschreiben sein — danach gelesen ist er immer der neue.
 * @param status Der `status` der Meldung; `null`, wenn der Server keinen
 *   geschickt hat. Aus `null` folgt nie ein Nachladen: Eine Meldung ohne
 *   Zustand ist kein Abschluss, sondern eine unvollständige Meldung.
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
