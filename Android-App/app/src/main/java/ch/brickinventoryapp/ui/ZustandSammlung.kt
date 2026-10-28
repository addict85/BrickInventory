package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * Galerie: Liste, Filter, Blätterstand und Kennzahlen. Eigener Fluss, weil sich
 * die Galerie am häufigsten ändert und nur wenige Bildschirme sie lesen; in
 * AppUiState zeichneten bei jedem Blättern alle anderen mit.
 */
data class GalleryUiState(
    val sets: List<SetItem> = emptyList(),
    /**
     * Galerie-Filter — ausgewertet wird er auf dem SERVER (Marcos Vorgabe).
     * Hier steht nur, was gerade eingestellt ist, damit die Oberfläche es
     * anzeigen und die nächste Seite mit denselben Werten nachladen kann.
     */
    val galleryQuery: String = "",
    val galleryTheme: String = "",
    val gallerySort: String = ch.brickinventoryapp.data.repository.GALLERY_DEFAULT_SORT,
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
    /** Liste aus dem Plattenspeicher statt vom Server: Zeitpunkt der Ablage, sonst null. */
    val offlineStand: Long? = null,
    val stats: DashboardStats? = null,
)

/**
 * Teile und Minifiguren — eigener Fluss: Nur zwei Bildschirme brauchen die Felder,
 * und jedes `partsLoading` beim Blättern zeichnete sonst alles neu, was AppUiState
 * liest.
 */
data class PartsUiState(
    val parts: List<Part> = emptyList(),
    /**
     * Die manuell erfassten Teile aus /api/v1/parts/manual, derselben Quelle wie die
     * Webapp — nicht aus der Bewertung, die dafür samt Marktpreisen geladen werden
     * müsste. null heisst „noch nicht geladen“, leer „keine vorhanden“: Die
     * Wiederherstellung der Rollposition wartet auf die Liste, auch wenn sie leer ist.
     */
    val manualParts: List<ch.brickinventoryapp.data.model.PartValuationItem>? = null,
    val partsTotal: Int = 0,
    val partsPage: Int = 1,
    /**
     * Der Suchtext der Teileliste im Zustand, nicht im Bildschirm: Jeder Lader
     * (Nachladen, Löschen, Kontofilter, Betreten) liest den Filter von hier; sonst
     * hängte `onLoadMore` eine ungefilterte Seite 2 an eine gefilterte Seite 1.
     */
    val partsQuery: String = "",
    /**
     * Ersatzteil-Filter: "" alle, "0" ohne, "1" nur Ersatzteile — die Werte der Webapp
     * (parts-spare). Im Zustand aus demselben Grund wie partsQuery.
     */
    val partsSpare: String = "",
    /**
     * Darstellung der Teileliste: "grid" oder "table", wie parts-view in der Webapp.
     * Im Zustand, weil der Ladeweg ihn braucht: `with_sets=1` kostet den Server eine
     * eigene Abfrage und wird nur für die Tabelle geholt.
     */
    val partsView: String = "grid",
    /**
     * Die beiden Filterlisten des Reiters — Farbe und Kategorie, mit Anzahl
     * (/parts/colors und /parts/categories, wie in der Webapp).
     */
    val partsFilterColors: List<ch.brickinventoryapp.data.model.PartsFilterColor> = emptyList(),
    val partsCategories: List<ch.brickinventoryapp.data.model.PartsCategory> = emptyList(),
    /** Gewaehlte Farbe; "" = alle. Der Wert reist als `color=` mit. */
    val partsColorFilter: String = "",
    /**
     * Gewählte Kategorie; "" = alle. Gespeichert wird der Wert (`category_name`, meist
     * eine Katalog-ID als Text), nicht die Beschriftung — der Server filtert danach.
     */
    val partsCategoryFilter: String = "",
    val partsLoading: Boolean = false,
    /** Teileliste aus dem Plattenspeicher: Zeitpunkt der Ablage, sonst null. */
    val teileOfflineStand: Long? = null,
    val minifigs: List<Minifig> = emptyList(),
    /** Die manuell erfassten Figuren — siehe manualParts, null wie dort. */
    val manualFigs: List<ch.brickinventoryapp.data.model.FigValuationItem>? = null,
    /** Kennzahlen der Kacheln — vom Server, nicht aus der (gefilterten) Liste. */
    val minifigStats: ch.brickinventoryapp.data.model.MinifigStats =
        ch.brickinventoryapp.data.model.MinifigStats(),
    val minifigsLoading: Boolean = false,
    /** Figurenliste aus dem Plattenspeicher: Zeitpunkt der Ablage, sonst null. */
    val figurenOfflineStand: Long? = null,
    /**
     * Suchtext der Figurenliste im Zustand: Gesucht wird auf dem Server, vor der
     * Gruppierung über jede fig_name-Zeile; eine zweite Suche im Composable träfe
     * anderes. Wie partsQuery.
     */
    val minifigsQuery: String = "",
    /**
     * Darstellung der Figurenliste: "grid" oder "table", wie figs-view in der Webapp.
     * Im Zustand, damit die Ansicht beim Zurücknavigieren dieselbe ist.
     */
    val minifigsView: String = "grid",
    val partsStats: PartsStats? = null,
    val partsColors: List<BrickColor> = emptyList(),
)

/**
 * Set-Detail — eigener Fluss: Preis- und Verlaufsabrufe zeichneten sonst alles
 * neu, was AppUiState liest, obwohl nur SetDetailScreen sie braucht.
 */
data class SetDetailUiState(
    val setDetail: SetItem? = null,
    val setDetailLoading: Boolean = false,
    val setPrice: SetPriceResponse? = null,
    val setPriceLoading: Boolean = false,
    // Die ganze Antwort statt einzelner Felder: Sie trägt seit der
    // Server-Umstellung beide Verlaufsreihen, die fertigen Diagrammdaten, die
    // aktuellen Preise und die Bewertung je Zustand. Einzeln herausgezogen
    // müsste jedes neue Feld hier UND in loadSetPriceHistory nachgeführt
    // werden — die Antwort ist bereits das Modell.
    val priceHistory: PriceHistoryResponse? = null,
    val priceHistoryLoading: Boolean = false,
    /**
     * Preisalarme dieses Sets, höchstens zwei (neu und gebraucht). Getrennt vom Set
     * geladen, weil sie zum Konto gehören: Zwei Personen mit demselben Set haben
     * verschiedene Alarme.
     */
    val preisalarme: List<ch.brickinventoryapp.data.model.Preisalarm> = emptyList(),
    val acquisitions: List<ch.brickinventoryapp.data.model.Acquisition> = emptyList(),
    /**
     * Summenzeile der Erfassungen — vom Server gerechnet, nicht hier.
     * Die Ansicht zeigt sie nur an; die Regel steht in utils/acquisitions.ts.
     */
    val acquisitionTotals: ch.brickinventoryapp.data.model.AcquisitionTotals =
        ch.brickinventoryapp.data.model.AcquisitionTotals(),
    val acquisitionsLoading: Boolean = false,
)

/**
 * Zustand für den Detail-Dialog manuell erfasster Teile und Minifiguren.
 * Getrennt vom Haupt-State damit Acquisition-Updates (die beim Editieren
 * häufig vorkommen) nicht die gesamte App rekomponieren.
 */
data class ManualItemDetailUiState(
    val acquisitions: List<ch.brickinventoryapp.data.model.Acquisition> = emptyList(),
    /** Summenzeile vom Server — siehe SetDetailUiState.acquisitionTotals. */
    val acquisitionTotals: ch.brickinventoryapp.data.model.AcquisitionTotals =
        ch.brickinventoryapp.data.model.AcquisitionTotals(),
    val isLoading: Boolean = false,
    // Identifiziert das aktuell geöffnete Element
    val itemType: String = "",       // "part" | "fig"
    val itemId: String = "",         // part_number oder fig_number
    val colorId: Int = 0,
    // `newQuantity` stand hier — die Gesamtmenge nach dem Loeschen einer
    // Erfassung. Gelesen wurde sie nie, und sie wird auch nicht gebraucht: Die
    // angezeigte Menge folgt der SUMME der Erfassungen
    // (ManualItemDetailScreen), und die laedt deleteManualAcquisition()
    // unmittelbar danach neu.
    /** Marktpreis je Zustand und Verlauf — dieselbe Antwortform wie beim Set. */
    val priceHistory: PriceHistoryResponse? = null,
    val priceHistoryLoading: Boolean = false,
)

/**
 * Der Detail-Dialog für ein Teil oder eine Figur aus einem Set: Zoom, Menge nur
 * zum Lesen, und in welchen Sets es steckt. Eigener Fluss, weil der Dialog
 * Zwischenstände erzeugt, die jeden Reiter angingen; `offen == null` heisst: kein
 * Dialog. Ein Zustand für beides, weil der Server dieselbe Form liefert.
 */
data class SetItemUiState(
    /** "part" oder "fig"; null heisst: der Dialog ist zu. */
    val art: String? = null,
    val nummer: String = "",
    val colorId: Int = 0,
    val laedt: Boolean = false,
    val kopf: BestandteilKopf? = null,
    val sets: List<VerwendendesSet> = emptyList(),
    val fehler: String? = null,
) {
    val offen: Boolean get() = art != null
}
