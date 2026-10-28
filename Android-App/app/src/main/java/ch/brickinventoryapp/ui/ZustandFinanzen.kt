package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * Finanzen: Bewertung, Gewinn/Verlust und Portfolio-Verlauf — ebenfalls aus
 * AppUiState herausgelöst.
 *
 * Der Verlauf wird beim Wechsel des Zeitraums komplett geleert und neu
 * geladen; als Teil des Haupt-States löste allein das eine App-weite
 * Rekomposition aus.
 */
data class FinanceUiState(
    val valuation: ValuationResponse? = null,
    val partsValuation: PartsValuationResponse? = null,
    val figsValuation: FigsValuationResponse? = null,
    val pnl: PnlResponse? = null,
    /**
     * Die Bewertung wird geholt. Kam aus AppUiState.isLoading — dort setzte
     * ausgerechnet `loadValuation()` das Feld am Ende auf `false` und beendete
     * damit die Ladeanzeige einer fremden Domäne (siehe AppUiState.loginLaeuft).
     */
    val valuationLoading: Boolean = false,
    val historyLoading: Boolean = false,
    val historyPeriodChangePct: Double? = null,
    val historyPoints: List<ChartPoint> = emptyList(),
    val historyYAxis: List<ChartYAxis> = emptyList(),
    val historyPeriod: String = "week",
    /**
     * Welche Zeilenarten der Reiter zeigt: "sets", "parts", "figs".
     *
     * ── Warum das hier steht und nicht im Bildschirm (Marcos Befund) ────────
     * „Wird in der Android-App im Reiter Finanzen ein Filter gesetzt und dann
     * ein Eintrag abgewaehlt und den Detail Dialog wieder verlassen ist der
     * Filter weg."
     *
     * Der Filter lag als `remember { mutableStateOf("alle") }` im
     * FinanceScreen. `remember` ueberlebt eine Rekomposition, aber NICHT das
     * Verlassen der Komposition — und genau das passiert beim Wechsel in einen
     * Detail-Bildschirm. Zurueck stand wieder „alle" da. Dieselbe Regel wie
     * bei den Listenfiltern (ListenfilterImZustandTest): Ein Filter, der eine
     * Ansicht einschraenkt, gehoert in den Zustand dieser Ansicht.
     *
     * ── Warum eine Menge und kein einzelner Wert (Marcos zweite Frage) ──────
     * „Kann der Filter zudem aditiv sein?" — ja. Vorher schloss jede Auswahl
     * die vorige aus, „Sets + Minifiguren ohne Teile" war nicht ausdrueckbar.
     *
     * LEER heisst ALLE. Das ist kein Sonderfall, sondern der Normalfall: Wer
     * nichts einschraenkt, sieht alles, und der Chip „Alle" ist genau dann
     * gewaehlt. Die Gegenrichtung — alle drei Kategorien einzeln eintragen —
     * saehe gleich aus, muesste aber jedes Mal mitgepflegt werden, sobald eine
     * vierte Zeilenart dazukaeme.
     */
    val kategorien: Set<String> = emptySet(),
) {
    /** Zeigt der Reiter diese Zeilenart? Leere Auswahl heisst: alle. */
    fun zeigt(kategorie: String): Boolean = kategorien.isEmpty() || kategorie in kategorien

    /**
     * Eine Zeilenart dazunehmen oder wegnehmen.
     *
     * Steht hier und nicht im ViewModel, damit die Regel ohne Android-Laufzeit
     * pruefbar ist — das ViewModel braucht Hilt und ein Repository, diese
     * Datenklasse nichts.
     */
    fun mitUmgeschalteterKategorie(kategorie: String): FinanceUiState =
        copy(kategorien = if (kategorie in kategorien) kategorien - kategorie
                          else kategorien + kategorie)
}

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Im Eigenen Profil sollen Lego-Gutscheine mit Gutscheinnummer und Pins und
 *    Betrag hinterlegt werden können. […] möglichst einfach erreichbar."
 *
 * Deshalb steht die Liste in den EINSTELLUNGEN, beim Profil — nicht in einem
 * eigenen Reiter. Genau wie in der Webapp.
 *
 * ── Warum die sichtbaren PINs im Zustand stehen ─────────────────────────────
 *
 * Der PIN ist standardmaessig verdeckt und wird je Zeile einzeln aufgedeckt.
 * Nicht aus Sicherheitsglauben — wer den Bildschirm sieht, ist angemeldet —,
 * sondern gegen die Schulter daneben: Eine Liste mit allen PINs im Klartext
 * ist das, was man nicht versehentlich herumzeigen will.
 *
 * Als Menge und nicht als Feld am Gutschein: Der Gutschein kommt vom Server
 * und soll genau das bleiben, was dort steht. Was die ANZEIGE gerade aufdeckt,
 * ist ein Zustand der Oberflaeche.
 */
data class GutscheinUiState(
    val gutscheine: List<ch.brickinventoryapp.data.model.Gutschein> = emptyList(),
    val laedt: Boolean = false,
    /** ids, deren PIN gerade im Klartext steht. */
    val pinSichtbar: Set<Int> = emptySet(),
    /** Der Gutschein, der gerade bearbeitet wird; null = neuer Eintrag. */
    val bearbeitet: Int? = null,
    // ── Die Formularfelder ──────────────────────────────────────────────────
    //
    // Als Zeichenketten, auch der Betrag: Waehrend des Tippens ist „12," weder
    // eine Zahl noch ein Fehler. Umgewandelt wird beim Speichern, und was sich
    // nicht umwandeln laesst, weist der SERVER ab — dieselbe Pruefung fuer
    // beide Apps (pruefeWerte in routes/api_v1/vouchers.ts).
    val nummer: String = "",
    val pin: String = "",
    val betrag: String = "",
    val waehrung: String = "CHF",
    /** Die gewaehlte PDF-Datei, solange sie noch nicht hochgeladen ist. */
    val pdfName: String? = null,
    /**
     * Welcher Gutschein sein PDF zeigen soll — oder null.
     *
     * Hier und nicht als Rueckruf-Parameter von SettingsScreen: Der Bildschirm
     * darf hoechstens sechs Parameter haben (ScreenViewModelWiringTest), und
     * ein siebter waere genau die breite Signatur, gegen die diese Regel
     * gebaut ist. Verbraucht wird das Ziel im Navigationsgraphen — nur der
     * kennt den NavController —, derselbe Weg wie bei MeldungsZielUiState.
     */
    val pdfZiel: Int? = null,
    /**
     * Ob der Export ALLER Gutscheine gezeigt werden soll.
     *
     * Ein zweites Feld neben [pdfZiel] und kein gemeinsamer Typ: Die beiden
     * kommen von verschiedenen Knoepfen, werden einzeln quittiert, und ein
     * versiegelter Typ darueber waere mehr Bauwerk als Auskunft. Der Weg
     * dahinter ist derselbe — der Graph schickt beide in den PdfViewerScreen
     * (Marcos Vorgabe: „Das erzeugte PDF soll analog den andere PDFs angezeigt
     * werden").
     */
    val exportZeigen: Boolean = false,
    val speichert: Boolean = false,
    /**
     * Die id der Karte, deren Guthaben gerade abgefragt wird — oder null.
     *
     * Eine id und kein Boolean: Der Knopf steht in JEDER Zeile, und nur der
     * gedrueckte soll sich ruehren. Ein gemeinsames „laedt" liesse alle
     * Knoepfe zugleich arbeiten, was nicht stimmt — es laeuft immer nur eine
     * Abfrage (der Server erlaubt eine je 30 Sekunden).
     */
    val guthabenLaeuft: Int? = null,
    /**
     * Der Lauf ueber alle Karten, oder null.
     *
     * Getrennt von [guthabenLaeuft]: Das sagt, WELCHE Karte gerade dran ist
     * (daran haengt der Kreisel in ihrer Zeile), dies sagt, dass ein ganzer
     * Durchgang laeuft (daran haengen Fortschritt und Abbrechen-Knopf). Beides
     * in ein Feld zu legen hiesse, aus zwei Fragen eine zu machen.
     */
    val guthabenLauf: GuthabenLauf? = null,
)

/**
 * Der Stand eines Laufs ueber ALLE Karten.
 *
 * ── Warum das sichtbar sein muss ────────────────────────────────────────────
 *
 * Der Server erlaubt eine Abfrage je 30 Sekunden ueber alle Benutzer (Marcos
 * Vorgabe). Vier Karten dauern also gut anderthalb Minuten. Ein Knopf, der so
 * lange nur ausgegraut ist, sagt niemandem, ob noch etwas passiert — deshalb
 * zaehlt der Lauf mit und nennt die Restzeit.
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
