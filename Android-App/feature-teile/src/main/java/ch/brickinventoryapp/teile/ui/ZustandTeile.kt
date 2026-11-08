package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.model.ui.model.*
import ch.brickinventoryapp.ui.Fehlerklasse

/**
 * Teile und Minifiguren — eigener Fluss: Nur zwei Bildschirme brauchen die Felder,
 * und jedes `partsLoading` beim Blättern zeichnete sonst alles neu, was AppUiState
 * liest.
 */
data class PartsUiState(
    val parts: List<TeilAnsicht> = emptyList(),
    /**
     * Die manuell erfassten Teile aus /api/v1/parts/manual, derselben Quelle wie die
     * Webapp — nicht aus der Bewertung, die dafür samt Marktpreisen geladen werden
     * müsste. null heisst „noch nicht geladen“, leer „keine vorhanden“: Die
     * Wiederherstellung der Rollposition wartet auf die Liste, auch wenn sie leer ist.
     */
    val manualParts: List<ManuellesTeilAnsicht>? = null,
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
    val partsFilterColors: List<FilterFarbeAnsicht> = emptyList(),
    val partsCategories: List<KategorieAnsicht> = emptyList(),
    /** Gewaehlte Farbe; "" = alle. Der Wert reist als `color=` mit. */
    val partsColorFilter: String = "",
    /**
     * Gewählte Kategorie; "" = alle. Gespeichert wird der Wert (`category_name`, meist
     * eine Katalog-ID als Text), nicht die Beschriftung — der Server filtert danach.
     */
    val partsCategoryFilter: String = "",
    val partsLoading: Boolean = false,
    /** Warum die Teile nicht kamen; null, solange nichts scheiterte. */
    val partsFehler: String? = null,
    val partsFehlerKlasse: Fehlerklasse? = null,
    /** Teileliste aus dem Plattenspeicher: Zeitpunkt der Ablage, sonst null. */
    val teileOfflineStand: Long? = null,
    val minifigs: List<FigurAnsicht> = emptyList(),
    /** Die manuell erfassten Figuren — siehe manualParts, null wie dort. */
    val manualFigs: List<ManuelleFigurAnsicht>? = null,
    /** Kennzahlen der Kacheln — vom Server, nicht aus der (gefilterten) Liste. */
    val minifigStats: FigurenKennzahlenAnsicht = FigurenKennzahlenAnsicht(),
    val minifigsLoading: Boolean = false,
    val minifigsFehler: String? = null,
    val minifigsFehlerKlasse: Fehlerklasse? = null,
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
    val partsStats: TeileKennzahlenAnsicht? = null,
    val partsColors: List<FarbeAnsicht> = emptyList(),
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
    val colorId: Int = OHNE_FARBE,
    val laedt: Boolean = false,
    val kopf: BestandteilKopfAnsicht? = null,
    val sets: List<VerwendendesSetAnsicht> = emptyList(),
    val fehler: String? = null,
) {
    val offen: Boolean get() = art != null
}

/**
 * Die Bauliste im ViewModel: Eine Drehung baut den Bildschirm neu, die erzeugte Liste
 * und ein laufender Abruf bleiben. Die Setnummern überleben auch das Prozessende
 * (SavedStateHandle), die Teile nicht — tausend Zeilen sprengten das Bundle.
 */
data class TeilelisteUiState(
    val sets: List<PlSet> = emptyList(),
    val parts: List<PlPart> = emptyList(),
    val generated: Boolean = false,
    val isLoading: Boolean = false,
    /** Fortschritt, Ergebnis oder Fehler der letzten Handlung, in der Sprache der App. */
    val status: String = "",
    val nurLose: Boolean = false,
    val mitUnterkonten: Boolean = false,
    val bestandLaeuft: Boolean = false,
    val isExporting: Boolean = false,
    val pdfError: String? = null,
    /** Fertiges PDF, das der Bildschirm einmal zum Öffnen anbietet. */
    val pdfDatei: java.io.File? = null,
)
