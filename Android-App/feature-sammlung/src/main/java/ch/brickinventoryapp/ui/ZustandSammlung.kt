package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.model.*
import ch.brickinventoryapp.data.repository.GALLERY_DEFAULT_SORT

/**
 * Galerie: Liste, Filter, Blätterstand und Kennzahlen. Eigener Fluss, weil sich
 * die Galerie am häufigsten ändert und nur wenige Bildschirme sie lesen; in
 * AppUiState zeichneten bei jedem Blättern alle anderen mit.
 */
data class GalleryUiState(
    val sets: List<SetAnsicht> = emptyList(),
    /**
     * Galerie-Filter — ausgewertet wird er auf dem Server, wie in der Webapp.
     * Hier steht nur, was gerade eingestellt ist, damit die Oberfläche es
     * anzeigen und die nächste Seite mit denselben Werten nachladen kann.
     */
    val galleryQuery: String = "",
    val galleryTheme: String = "",
    val gallerySort: String = GALLERY_DEFAULT_SORT,
    /** Themen des ganzen Bestands — vom Server, nicht aus der geladenen Seite. */
    val galleryThemes: List<String> = emptyList(),
    val galleryTotal: Int = 0,
    val galleryPage: Int = 1,
    /**
     * Erste Seite oder Neuladen. `galleryLoadingMore` ist das Gegenstück fürs Anhängen
     * — getrennt, weil die Oberfläche beide verschieden zeigt und der Wächter in
     * loadMoreSets() beide braucht.
     */
    val galleryLoading: Boolean = false,
    val galleryLoadingMore: Boolean = false,
    /**
     * Warum die erste Seite nicht kam, als Satz für die Anzeige; null nach
     * Erfolg. Ohne das sah ein Ladefehler aus wie eine leere Sammlung.
     */
    val galleryFehler: String? = null,
    /** Wofür der Fehler steht — Symbol und Rat im Fehlerzustand. */
    val galleryFehlerKlasse: Fehlerklasse? = null,
    /** Liste aus dem Plattenspeicher statt vom Server: Zeitpunkt der Ablage, sonst null. */
    val offlineStand: Long? = null,
    val stats: KennzahlenAnsicht? = null,
)

/**
 * Set-Detail — eigener Fluss: Preis- und Verlaufsabrufe zeichneten sonst alles
 * neu, was AppUiState liest, obwohl nur SetDetailScreen sie braucht.
 */
data class SetDetailUiState(
    val setDetail: SetAnsicht? = null,
    val setDetailLoading: Boolean = false,
    /** Ohne Detail und ohne Vorschau aus der Galerie bliebe sonst der Kringel stehen. */
    val setDetailFehler: String? = null,
    val setDetailFehlerKlasse: Fehlerklasse? = null,
    val setPrice: SetPreisAnsicht? = null,
    val setPriceLoading: Boolean = false,
    // Die ganze Antwort statt einzelner Felder: Sie trägt seit der
    // Server-Umstellung beide Verlaufsreihen, die fertigen Diagrammdaten, die
    // aktuellen Preise und die Bewertung je Zustand. Einzeln herausgezogen
    // müsste jedes neue Feld hier UND in loadSetPriceHistory nachgeführt
    // werden — die Antwort ist bereits das Modell.
    val priceHistory: PreisverlaufAnsicht? = null,
    val priceHistoryLoading: Boolean = false,
    /**
     * Preisalarme dieses Sets, höchstens zwei (neu und gebraucht). Getrennt vom Set
     * geladen, weil sie zum Konto gehören: Zwei Personen mit demselben Set haben
     * verschiedene Alarme.
     */
    val preisalarme: List<PreisalarmAnsicht> = emptyList(),
    val acquisitions: List<KaufAnsicht> = emptyList(),
    /**
     * Summenzeile der Erfassungen — vom Server gerechnet, nicht hier.
     * Die Ansicht zeigt sie nur an; die Regel steht in utils/acquisitions.ts.
     */
    val acquisitionTotals: KaufSummenAnsicht = KaufSummenAnsicht(),
    val acquisitionsLoading: Boolean = false,
)
