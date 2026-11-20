package ch.brickinventoryapp.sammlung.ui

import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.model.fach.KaufAnsicht
import ch.brickinventoryapp.model.fach.PurchaseSumsView
import ch.brickinventoryapp.model.fach.MetricsView
import ch.brickinventoryapp.model.fach.PriceAlertView
import ch.brickinventoryapp.model.fach.PriceHistoryView
import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.model.fach.SetPriceView

/**
 * Galerie: Liste, Filter, Blätterstand und Kennzahlen. Eigener Fluss, weil sich
 * die Galerie am häufigsten ändert und nur wenige Bildschirme sie lesen; in
 * AppUiState zeichneten bei jedem Blättern alle anderen mit.
 */
data class GalleryUiState(
    val sets: List<SetAnsicht> = emptyList(),
    /** Galerie-Filter, wie eingestellt; die Quelle (Ablage oder Kontosicht) wertet ihn aus. */
    val galleryQuery: String = "",
    val galleryTheme: String = "",
    val gallerySort: Setsortierung = Setsortierung.DEFAULT,
    /** Themen des ganzen Bestands, aus der ungefilterten Liste. */
    val galleryThemes: List<String> = emptyList(),
    val galleryTotal: Int = 0,
    /**
     * Die Quelle wird gefüllt; die Liste steht schon da, soweit sie abgelegt ist. Ohne den
     * Fehler sah ein Ladefehler aus wie eine leere Sammlung.
     */
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    /** Liste aus dem Plattenspeicher statt vom Server: Zeitpunkt der Ablage, sonst null. */
    val offlineStatus: Long? = null,
    val stats: MetricsView? = null,
)

/**
 * Set-Detail — eigener Fluss: Preis- und Verlaufsabrufe zeichneten sonst alles
 * neu, was AppUiState liest, obwohl nur SetDetailScreen sie braucht.
 */
data class SetDetailUiState(
    val setDetail: SetAnsicht? = null,
    /** Ohne Detail und ohne Vorschau aus der Galerie bliebe sonst der Kringel stehen. */
    val detailFetch: Laden<Unit> = Laden.Daten(Unit),
    val setPrice: SetPriceView? = null,
    /** Preis und Verlauf scheitern für sich; die Karte sagt es statt leer zu bleiben. */
    val priceFetch: Laden<Unit> = Laden.Daten(Unit),
    // Die ganze Antwort statt einzelner Felder: Sie trägt seit der
    // Server-Umstellung beide Verlaufsreihen, die fertigen Diagrammdaten, die
    // aktuellen Preise und die Bewertung je Zustand. Einzeln herausgezogen
    // müsste jedes neue Feld hier UND in loadHistory nachgeführt
    // werden — die Antwort ist bereits das Modell.
    val priceHistory: PriceHistoryView? = null,
    val historyFetch: Laden<Unit> = Laden.Daten(Unit),
    /**
     * Preisalarme dieses Sets, höchstens zwei (neu und gebraucht). Getrennt vom Set
     * geladen, weil sie zum Konto gehören: Zwei Personen mit demselben Set haben
     * verschiedene Alarme.
     */
    val preisalarme: List<PriceAlertView> = emptyList(),
    val acquisitions: List<KaufAnsicht> = emptyList(),
    /**
     * Summenzeile der Erfassungen — vom Server gerechnet, nicht hier.
     * Die Ansicht zeigt sie nur an; die Regel steht in utils/acquisitions.ts.
     */
    val acquisitionTotals: PurchaseSumsView = PurchaseSumsView(),
    val purchasesFetch: Laden<Unit> = Laden.Daten(Unit),
)
