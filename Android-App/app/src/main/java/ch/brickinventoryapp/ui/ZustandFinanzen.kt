package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * Finanzen: Bewertung, Gewinn/Verlust und Portfolio-Verlauf — eigener Fluss, weil
 * der Verlauf beim Wechsel des Zeitraums geleert und neu geladen wird und das
 * sonst die ganze App neu zeichnete.
 */
data class FinanceUiState(
    val valuation: ValuationResponse? = null,
    val partsValuation: PartsValuationResponse? = null,
    val figsValuation: FigsValuationResponse? = null,
    val pnl: PnlResponse? = null,
    /**
     * Die Bewertung wird geholt — ein eigenes Feld statt eines geteilten `isLoading`,
     * das fremde Ladeanzeigen beendete.
     */
    val valuationLoading: Boolean = false,
    val historyLoading: Boolean = false,
    val historyPeriodChangePct: Double? = null,
    val historyPoints: List<ChartPoint> = emptyList(),
    val historyYAxis: List<ChartYAxis> = emptyList(),
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
    val gutscheine: List<ch.brickinventoryapp.data.model.Gutschein> = emptyList(),
    val laedt: Boolean = false,
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
     * Welcher Gutschein sein PDF zeigen soll, oder null. Im Zustand statt als Rückruf,
     * weil SettingsScreen höchstens sechs Parameter haben darf
     * (ScreenViewModelWiringTest); verbraucht wird das Ziel im Graphen, der den
     * NavController kennt.
     */
    val pdfZiel: Int? = null,
    /**
     * Ob der Export aller Gutscheine gezeigt werden soll. Ein eigenes Feld neben
     * [pdfZiel]: zwei Knöpfe, einzeln quittiert; der Graph schickt beide in den
     * PdfViewerScreen.
     */
    val exportZeigen: Boolean = false,
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
fun gutscheinSumme(gutscheine: List<ch.brickinventoryapp.data.model.Gutschein>): Pair<java.math.BigDecimal, String>? {
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
