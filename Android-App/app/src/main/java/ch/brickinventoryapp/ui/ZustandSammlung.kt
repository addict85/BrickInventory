package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * Galerie: Liste, Filter, Blaetterstand und Kennzahlen.
 *
 * ── Warum diese zehn Felder aus AppUiState heraus mussten ───────────────────
 * NACHGEMESSEN, nicht vermutet: SECHZEHN Dateien sammeln `vm.state`. Gelesen
 * werden die Galerie-Felder aber nur von dreien (GalleryScreen,
 * CollectionGraph, SetDetailScreen). Die uebrigen dreizehn wurden bei jedem
 * Blaettern, jeder Suche und jedem Nachladen neu zusammengesetzt, ohne ein
 * einziges dieser Felder zu lesen — Minifiguren, Finanzen, Einstellungen, die
 * Navigationsleiste.
 *
 * Und gerade die Galerie ist der Zustand, der sich am haeufigsten aendert:
 * `galleryLoadingMore` allein wird an fuenf Stellen geschrieben, `sets` an
 * sechs.
 *
 * Es ist dasselbe Muster, das fuer Teile, Finanzen, Katalog und den Barcode
 * schon vollzogen wurde (Nachtraege 117 ff.) — bei der Galerie war es
 * steckengeblieben, ausgerechnet beim groessten und lautesten Block.
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
     * Erste Seite / Neuladen. `galleryLoadingMore` ist das Gegenstück fürs
     * Anhängen — getrennt, weil die Oberfläche beide unterschiedlich zeigt
     * (Kringel oben gegen Fussleiste unten) und der Wächter in loadMoreSets()
     * beide braucht.
     *
     * Kam aus AppUiState.isLoading hierher: Dort teilte sich die Galerie das
     * Feld mit Anmeldung, Teileliste und Bewertung. Siehe AppUiState.loginLaeuft.
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
 * Teile & Minifiguren — eigener Flow (gleiches Muster wie CatalogUiState).
 *
 * Diese Felder lagen bis zuletzt in AppUiState. Folge: Jedes `partsLoading`
 * beim Blättern durch die Teileliste rekomponierte auch die Galerie, die
 * Navigationsleiste und alles andere, was AppUiState liest — obwohl nur zwei
 * Screens diese Daten überhaupt brauchen.
 */
data class PartsUiState(
    val parts: List<Part> = emptyList(),
    /**
     * Die manuell erfassten Teile — aus /api/v1/parts/manual, derselben
     * Quelle wie die Webapp.
     *
     * Sie kamen bisher aus der BEWERTUNG (FinanceUiState.partsValuation).
     * Zwei Quellen fuer dieselbe Liste, und die App lud dafuer jedes Mal die
     * ganze Bewertung samt Marktpreis-Abfragen — obwohl die Kachel nur
     * Nummer, Name, Farbe, Zustand, Bild, Menge und Besitzer zeigt.
     *
     * NULL heisst „noch nicht geladen", eine leere Liste „keine vorhanden".
     * Der Unterschied traegt: Die Wiederherstellung der Rollposition wartet
     * darauf, dass die Liste DA ist — auf `isNotEmpty()` zu warten hiesse,
     * dass sie bei jemandem ohne eigene Teile nie wiederhergestellt wuerde
     * (so stand es schon einmal da, siehe CollectionGraph).
     */
    val manualParts: List<ch.brickinventoryapp.data.model.PartValuationItem>? = null,
    val partsTotal: Int = 0,
    val partsPage: Int = 1,
    /**
     * Der Suchtext der Teileliste — im ZUSTAND, nicht im Bildschirm.
     *
     * Er stand als `var searchQuery by rememberSaveable` in PartsScreen und
     * wurde jedem Ladeaufruf als Argument mitgegeben. Jeder Weg, der die Liste
     * NICHT aus dem Suchfeld heraus nachlud, kannte ihn damit nicht:
     * `onLoadMore` holte Seite 2 ungefiltert und haengte sie an eine
     * gefilterte Seite 1, und `partsTotal` kam aus der ungefilterten Abfrage.
     * Ebenso nach dem Loeschen eines manuellen Teils, nach einem Wechsel des
     * Kontofilters und beim Betreten des Reiters.
     *
     * Die Galerie macht es seit jeher so (galleryQuery daneben) — dort liest
     * JEDER Lader den Filter aus dem Zustand, und genau deshalb gab es das
     * Problem dort nicht.
     */
    val partsQuery: String = "",
    /**
     * Ersatzteil-Filter: "" alle, "0" ohne Ersatzteile, "1" nur Ersatzteile.
     *
     * Dieselben drei Werte wie das Auswahlfeld der Webapp (parts-spare in
     * index.html). Die App las `is_spare` bisher zwar aus der Antwort und hatte
     * sogar einen Helfer dafuer (Part.isSpareFlag) — benutzt hat sie beides
     * nirgends. Wer am Telefon nachsah, wie viele Teile er wirklich hat, bekam
     * die Ersatzteile immer mitgezaehlt; am Rechner konnte er sie ausblenden.
     *
     * Aus demselben Grund wie partsQuery im Zustand und nicht im Bildschirm:
     * Sonst kennt ihn nur, wer aus dem Filter heraus laedt, und `onLoadMore`
     * haengt eine ungefilterte Seite 2 an eine gefilterte Seite 1.
     */
    val partsSpare: String = "",
    /**
     * Darstellung der Teileliste: "grid" (Karten) oder "table" (Zeilen).
     *
     * Wie in der Webapp (Auswahlfeld parts-view). Im Zustand und nicht im
     * Bildschirm, weil der Ladeweg ihn braucht: Die Spalte „In Sets" kostet
     * den Server eine eigene Abfrage, deshalb holt die Webapp `with_sets=1`
     * NUR in der Tabellenansicht — und die App tut es genauso.
     */
    val partsView: String = "grid",
    /**
     * Die beiden Filterlisten des Reiters — Farbe und Kategorie, mit Anzahl.
     *
     * ── Warum sie fehlten (Nachtrag 134) ────────────────────────────────────
     *
     * Gemessen, nicht gelesen: Ein Vergleich der Server-Adressen beider
     * Clients zeigte 21 Adressen, die nur die Webapp ruft — darunter
     * /parts/colors und /parts/categories. Die App bot im Teile-Reiter
     * ausschliesslich die Suche.
     *
     * Bemerkenswert war der Zustand der Leitung: `BrickApiService.getParts`
     * deklariert `@Query("color")` und `@Query("category")` seit jeher, und
     * `TeileRepository.getParts` reicht beide durch. Nur gesetzt hat sie nie
     * jemand — eine halbfertige Funktion, die in keiner Pruefung auffiel, weil
     * Vorgabewerte kein toter Code sind.
     */
    val partsFilterColors: List<ch.brickinventoryapp.data.model.PartsFilterColor> = emptyList(),
    val partsCategories: List<ch.brickinventoryapp.data.model.PartsCategory> = emptyList(),
    /** Gewaehlte Farbe; "" = alle. Der Wert reist als `color=` mit. */
    val partsColorFilter: String = "",
    /**
     * Gewaehlte Kategorie; "" = alle.
     *
     * Gespeichert wird der WERT (`category_name`, meist eine Katalog-ID als
     * Text), nicht die Beschriftung — der Server filtert danach.
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
     * Suchtext der Figurenliste — im Zustand, nicht im Composable.
     *
     * Er stand als `var search by rememberSaveable` in MinifigsScreen und
     * filterte die schon geladene Liste. Damit gab es dieselbe Suchregel
     * zweimal (hier und im Server-Handler), und sie waren nicht deckungsgleich:
     * Der Server sucht vor der Gruppierung ueber jede fig_name-Zeile, das
     * Composable danach ueber die eine, die uebrig bleibt. Aus demselben Grund
     * steht partsQuery oben im Zustand.
     */
    val minifigsQuery: String = "",
    /**
     * Darstellung der Figurenliste: "grid" oder "table" — wie figs-view in der
     * Webapp. Anders als bei den Teilen braucht der Ladeweg ihn nicht (es gibt
     * keine zusaetzliche Spalte vom Server), er steht aber aus demselben Grund
     * hier: Beim Zuruecknavigieren soll die Ansicht dieselbe sein.
     */
    val minifigsView: String = "grid",
    val partsStats: PartsStats? = null,
    val partsColors: List<BrickColor> = emptyList(),
)

/**
 * Set-Detail-Zustand — getrennt vom Haupt-State (gleiches Muster wie
 * CsvImportUiState): Preis- und History-Loads im Detail-Screen haben sonst
 * bei jedem Update alle Composables rekomponiert, die AppUiState lesen,
 * obwohl nur der SetDetailScreen diese Felder braucht.
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
     * Preisalarme dieses Sets — hoechstens zwei (neu und gebraucht).
     *
     * Getrennt vom setDetail geladen, weil sie NICHT zum Set gehoeren,
     * sondern zum Konto: Zwei Personen mit demselben Set haben
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
    /**
     * Marktpreis je Zustand und Verlauf — dieselbe Antwortform wie beim Set.
     *
     * Bis hardened-96 gab es die beiden Endpunkte nur für die Webapp; der
     * Dialog hier zeigte deshalb Kaufpreise, aber keinen Marktpreis.
     */
    val priceHistory: PriceHistoryResponse? = null,
    val priceHistoryLoading: Boolean = false,
)

/**
 * Der Detail-Dialog fuer ein Teil / eine Figur AUS EINEM SET.
 *
 * ── Marcos Wunsch ──────────────────────────────────────────────────────────
 * „Auch die automatisch erfassten Teile und Minifiguren sollen einen
 * Detail-Dialog inkl. Zoom haben. Der Marktpreis kann weggelassen werden, die
 * Anzahl soll nicht geaendert werden koennen. Dafuer soll angezeigt werden,
 * welche Sets dieses Teil und Minifigur verwenden — inkl. Link, um den
 * Detail-Dialog des Sets oeffnen zu koennen."
 *
 * ── Warum ein eigener Fluss ────────────────────────────────────────────────
 * Dieselbe Ueberlegung wie bei BarcodeUiState: Ein geoeffneter Dialog erzeugt
 * Zwischenstaende (laedt, da, Fehler), und die gingen als Felder in AppUiState
 * jeden Reiter an. `offen == null` heisst: kein Dialog.
 *
 * EIN Zustand fuer Teile UND Figuren — der Server beantwortet beide Faelle mit
 * derselben Funktion und liefert dieselbe Form. Zwei Zustaende waeren zwei
 * Stellen, an denen dasselbe steht.
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
