package ch.brickinventoryapp.finanzen.ui

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.PlaintextView
import ch.brickinventoryapp.model.fach.BewertungAnsicht
import ch.brickinventoryapp.model.fach.ChartAxis
import ch.brickinventoryapp.model.fach.DiagrammPunkt
import ch.brickinventoryapp.model.fach.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.fach.GewinnAnsicht
import ch.brickinventoryapp.model.fach.VoucherView
import ch.brickinventoryapp.model.fach.TeileBewertungAnsicht
import ch.brickinventoryapp.model.ui.Laden

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
     * Der Abruf der Bewertung, getrennt vom Verlauf: Ein geteilter Ladezustand beendete
     * fremde Anzeigen. Ohne den Fehler zeigte der Reiter „keine Preisdaten“.
     */
    val bewertung: Laden<Unit> = Laden.Daten(Unit),
    val verlauf: Laden<Unit> = Laden.Daten(Unit),
    val historyPeriodChangePct: Double? = null,
    /**
     * Punkte und Achse, wie der Server sie schickt. Übersetzt werden sie erst beim
     * Zeichnen (FinanceScreen): Die Sprache beim Laden ist nicht die beim Anzeigen.
     */
    val historyPoints: List<DiagrammPunkt> = emptyList(),
    val historyYAxis: List<ChartAxis> = emptyList(),
    /** Der ISO-Tag jedes Punkts (chart.x) — daraus entsteht die lokale x-Achse. */
    val historyDays: List<String> = emptyList(),
    /** Währung der y-Achse; null = die der Bewertung. */
    val historyCurrency: Waehrung? = null,
    val historyPeriod: String = "week",
    /**
     * Welche Zeilenarten der Reiter zeigt: "sets", "parts", "figs". Im Zustand und
     * nicht im Bildschirm, weil ein `remember` den Wechsel in ein Detail nicht
     * überlebt (wie die Listenfilter, ListenfilterInStateTest). Eine Menge, damit
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
    fun withToggledCategory(kategorie: String): FinanceUiState =
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
    val gutscheine: List<VoucherView> = emptyList(),
    /** Ein Fehler steht statt „keine Gutscheine“, solange die Liste leer ist. */
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    /** ids, deren PIN gerade im Klartext steht. */
    val pinSichtbar: Set<Int> = emptySet(),
    /** Der Gutschein, der gerade bearbeitet wird; null = neuer Eintrag. */
    val edited: Int? = null,
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
    val pdfTarget: VoucherPdfTarget? = null,
    /** Die laufende Rückfrage nach Passwort und Code, oder null. */
    val confirmation: VoucherConfirmation? = null,
    /**
     * Nummer und PIN im Klartext je id, solange die Seite offen ist. Nur hier, nie
     * in Ablage oder Cache; GutscheineUnterseite leert es beim Verlassen.
     */
    val klartext: Map<Int, PlaintextView> = emptyMap(),
    /** Was die Oberfläche in die Zwischenablage legen soll; sie quittiert. */
    val copyTo: CopyJob? = null,
    val speichern: Vorgang = Vorgang.Fertig,
    /**
     * Die id der Karte, deren Guthaben gerade abgefragt wird, oder null. Eine id statt
     * eines Booleans, damit sich nur der gedrückte Knopf rührt — es läuft immer nur
     * eine Abfrage.
     */
    val balanceRunning: Int? = null,
    /**
     * Der Lauf über alle Karten, oder null. Getrennt von [balanceRunning]: Das sagt,
     * welche Karte dran ist (Kreisel), dies, dass ein Durchgang läuft (Fortschritt,
     * Abbrechen).
     */
    val balanceRun: BalanceRun? = null,
)

/**
 * Die Summe der Gutscheine, nur bei EINER Währung: Beträge verschiedener
 * Währungen ergäben eine Zahl, die richtig aussieht und keine ist. In
 * BigDecimal, weil die App diese Summe selbst bildet und 0.1 + 0.2 als Double
 * nicht 0.3 ist.
 */
internal fun voucherSum(gutscheine: List<VoucherView>): Pair<java.math.BigDecimal, Waehrung>? {
    val waehrung = gutscheine.map { it.currency }.distinct().singleOrNull() ?: return null
    return gutscheine.fold(java.math.BigDecimal.ZERO) { s, g -> s + g.amount.asBigDecimal() }
        .setScale(2, java.math.RoundingMode.HALF_UP) to waehrung
}

/**
 * Der Stand eines Laufs über alle Karten: Bei einer Abfrage je 30 Sekunden dauert
 * er Minuten, deshalb zählt er mit und nennt die Restzeit.
 */
data class BalanceRun(
    /** Wie viele Karten schon durch sind (erfolgreich oder nicht). */
    val erledigt: Int = 0,
    val gesamt: Int = 0,
    /** Die Karte, an der es gerade haengt. */
    val nummer: String = "",
    /** Sekunden bis zum naechsten Versuch, oder 0 waehrend der Abfrage. */
    val wartenSek: Int = 0,
)

/** Ein freigegebenes PDF; ohne [id] das aller Gutscheine. */
data class VoucherPdfTarget(val id: Int?, val ticket: String)

/** Was erst nach Gerätesperre und Passwort geschieht. */
enum class VoucherStep { PIN_ZEIGEN, NUMBER_COPY, PIN_COPY, PDF, EXPORT, DELETE }

/**
 * Die Rückfrage nach Passwort (und Code), bevor [schritt] für Gutschein [id]
 * läuft; [id] ist null beim Export aller.
 */
data class VoucherConfirmation(
    val schritt: VoucherStep,
    val id: Int?,
    /** Der Server hat den Code des zweiten Faktors verlangt. */
    val codeNoetig: Boolean = false,
    val operation: Vorgang = Vorgang.Fertig,
)

data class CopyJob(val wert: String, val isNumber: Boolean)
