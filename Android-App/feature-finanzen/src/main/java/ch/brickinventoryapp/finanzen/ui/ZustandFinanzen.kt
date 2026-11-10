package ch.brickinventoryapp.finanzen.ui

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.model.KlartextAnsicht
import ch.brickinventoryapp.model.ui.model.*
import ch.brickinventoryapp.model.ui.Fehlerklasse

/**
 * Finanzen: Bewertung, Gewinn/Verlust und Portfolio-Verlauf — eigener Fluss, weil
 * der Verlauf beim Wechsel des Zeitraums geleert und neu geladen wird und das
 * sonst die ganze App neu zeichnete.
 */
data class FinanceUiState(
    val valuation: BewertungAnsicht? = null,
    val partsValuation: TeileBewertungAnsicht? = null,
    val figsValuation: FigurenBewertungAnsicht? = null,
    val pnl: GewinnAnsicht? = null,
    /**
     * Die Bewertung wird geholt — ein eigenes Feld statt eines geteilten `isLoading`,
     * das fremde Ladeanzeigen beendete.
     */
    val valuationLoading: Boolean = false,
    /** Warum die Bewertung nicht kam; ohne sie zeigte der Reiter „keine Preisdaten“. */
    val valuationFehler: String? = null,
    val valuationFehlerKlasse: Fehlerklasse? = null,
    val historyLoading: Boolean = false,
    val historyPeriodChangePct: Double? = null,
    /**
     * Punkte und Achse, wie der Server sie schickt. Übersetzt werden sie erst beim
     * Zeichnen (FinanceScreen): Die Sprache beim Laden ist nicht die beim Anzeigen.
     */
    val historyPoints: List<DiagrammPunkt> = emptyList(),
    val historyYAxis: List<DiagrammAchse> = emptyList(),
    /** Der ISO-Tag jedes Punkts (chart.x) — daraus entsteht die lokale x-Achse. */
    val historyTage: List<String> = emptyList(),
    /** Währung der y-Achse; null = die der Bewertung. */
    val historyWaehrung: Waehrung? = null,
    val historyPeriod: String = "week",
    /**
     * Welche Zeilenarten der Reiter zeigt: "sets", "parts", "figs". Im Zustand und
     * nicht im Bildschirm, weil ein `remember` den Wechsel in ein Detail nicht
     * überlebt (wie die Listenfilter, ListenfilterImZustandTest). Eine Menge, damit
     * sich Arten kombinieren lassen; leer heisst alle — so muss keine Liste
     * nachgezogen werden, wenn eine Art dazukommt.
     */
    val kategorien: Set<String> = emptySet(),
) {
    /** Zeigt der Reiter diese Zeilenart? Leere Auswahl heisst: alle. */
    fun zeigt(kategorie: String): Boolean = kategorien.isEmpty() || kategorie in kategorien

    /**
     * Eine Zeilenart dazunehmen oder wegnehmen. Hier statt im ViewModel, damit die
     * Regel ohne Android-Laufzeit prüfbar ist.
     */
    fun mitUmgeschalteterKategorie(kategorie: String): FinanceUiState =
        copy(kategorien = if (kategorie in kategorien) kategorien - kategorie
                          else kategorien + kategorie)
}

/**
 * Gutscheine im eigenen Profil, in den Einstellungen wie in der Webapp. Die
 * aufgedeckten PINs stehen als Menge im Zustand: Der PIN ist verdeckt gegen die
 * Schulter daneben; was die Anzeige aufdeckt, ist ein Zustand der Oberfläche, der
 * Gutschein bleibt, was der Server schickt.
 */
data class GutscheinUiState(
    val gutscheine: List<GutscheinAnsicht> = emptyList(),
    val laedt: Boolean = false,
    /** Warum die Liste nicht kam; sonst stünde „keine Gutscheine“ da. */
    val fehler: String? = null,
    /** ids, deren PIN gerade im Klartext steht. */
    val pinSichtbar: Set<Int> = emptySet(),
    /** Der Gutschein, der gerade bearbeitet wird; null = neuer Eintrag. */
    val bearbeitet: Int? = null,
    // ── Die Formularfelder ──
    //
    // Als Zeichenketten, auch der Betrag: Während des Tippens ist „12,“ weder Zahl
    // noch Fehler. Was sich beim Speichern nicht umwandeln lässt, weist der Server ab
    // (pruefeWerte in routes/api_v1/vouchers.ts).
    val nummer: String = "",
    val pin: String = "",
    val betrag: String = "",
    val waehrung: String = "CHF",
    /** Die gewaehlte PDF-Datei, solange sie noch nicht hochgeladen ist. */
    val pdfName: String? = null,
    /**
     * Das freigegebene PDF, das der Graph im Betrachter öffnen soll, oder null. Im
     * Zustand statt als Rückruf, weil der Graph den NavController kennt; er quittiert.
     */
    val pdfZiel: GutscheinPdfZiel? = null,
    /** Die laufende Rückfrage nach Passwort und Code, oder null. */
    val bestaetigung: GutscheinBestaetigung? = null,
    /**
     * Nummer und PIN im Klartext je id, solange die Seite offen ist. Nur hier, nie
     * in Ablage oder Cache; GutscheineUnterseite leert es beim Verlassen.
     */
    val klartext: Map<Int, KlartextAnsicht> = emptyMap(),
    /** Was die Oberfläche in die Zwischenablage legen soll; sie quittiert. */
    val zuKopieren: Kopierauftrag? = null,
    val speichert: Boolean = false,
    /**
     * Die id der Karte, deren Guthaben gerade abgefragt wird, oder null. Eine id statt
     * eines Booleans, damit sich nur der gedrückte Knopf rührt — es läuft immer nur
     * eine Abfrage.
     */
    val guthabenLaeuft: Int? = null,
    /**
     * Der Lauf über alle Karten, oder null. Getrennt von [guthabenLaeuft]: Das sagt,
     * welche Karte dran ist (Kreisel), dies, dass ein Durchgang läuft (Fortschritt,
     * Abbrechen).
     */
    val guthabenLauf: GuthabenLauf? = null,
)

/**
 * Die Summe der Gutscheine, nur bei EINER Währung: Beträge verschiedener
 * Währungen ergäben eine Zahl, die richtig aussieht und keine ist. In
 * BigDecimal, weil die App diese Summe selbst bildet und 0.1 + 0.2 als Double
 * nicht 0.3 ist.
 */
internal fun gutscheinSumme(gutscheine: List<GutscheinAnsicht>): Pair<java.math.BigDecimal, Waehrung>? {
    val waehrung = gutscheine.map { it.currency }.distinct().singleOrNull() ?: return null
    return gutscheine.fold(java.math.BigDecimal.ZERO) { s, g -> s + java.math.BigDecimal.valueOf(g.amount) }
        .setScale(2, java.math.RoundingMode.HALF_UP) to waehrung
}

/**
 * Der Stand eines Laufs über alle Karten: Bei einer Abfrage je 30 Sekunden dauert
 * er Minuten, deshalb zählt er mit und nennt die Restzeit.
 */
data class GuthabenLauf(
    /** Wie viele Karten schon durch sind (erfolgreich oder nicht). */
    val erledigt: Int = 0,
    val gesamt: Int = 0,
    /** Die Karte, an der es gerade haengt. */
    val nummer: String = "",
    /** Sekunden bis zum naechsten Versuch, oder 0 waehrend der Abfrage. */
    val wartenSek: Int = 0,
)

/** Ein freigegebenes PDF; ohne [id] das aller Gutscheine. */
data class GutscheinPdfZiel(val id: Int?, val ticket: String)

/** Was erst nach Gerätesperre und Passwort geschieht. */
enum class GutscheinSchritt { PIN_ZEIGEN, NUMMER_KOPIEREN, PIN_KOPIEREN, PDF, EXPORT, LOESCHEN }

/**
 * Die Rückfrage nach Passwort (und Code), bevor [schritt] für Gutschein [id]
 * läuft; [id] ist null beim Export aller.
 */
data class GutscheinBestaetigung(
    val schritt: GutscheinSchritt,
    val id: Int?,
    /** Der Server hat den Code des zweiten Faktors verlangt. */
    val codeNoetig: Boolean = false,
    val fehler: String? = null,
    val laeuft: Boolean = false,
)

data class Kopierauftrag(val wert: String, val istNummer: Boolean)
