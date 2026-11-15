package ch.brickinventoryapp.katalog.ui

import ch.brickinventoryapp.model.fach.Katalogsortierung
import ch.brickinventoryapp.model.fach.JahrAnzahlAnsicht
import ch.brickinventoryapp.model.fach.KatalogDetailAnsicht
import ch.brickinventoryapp.model.fach.KatalogSetAnsicht
import ch.brickinventoryapp.model.fach.KatalogThemaAnsicht
import ch.brickinventoryapp.model.ui.Laden

/**
 * Katalog-Zustand — eigener Flow (wie SetDetail/CsvImport): Suche und
 * Paging aktualisieren häufig; als Teil von AppUiState würde jede
 * Katalog-Seite die gesamte App rekomponieren.
 */
data class CatalogUiState(
    /** Der letzte Abruf der ersten Seite; geladene Seiten bleiben stehen, solange neu geholt wird. */
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    /**
     * Geladene Seiten, nach Seitennummer. Eine Karte statt einer Liste, weil die
     * Zeitleiste rechts schnell scrollt statt filtert: Wer auf 2005 springt, landet
     * mitten im Bestand. Die Ansicht führt deshalb alle `total` Plätze und lädt die
     * Seite, die gerade sichtbar wird — vorwärts wie rückwärts; was noch fehlt, steht
     * als Platzhalter.
     */
    val loadedPages: Map<Int, List<KatalogSetAnsicht>> = emptyMap(),
    val loadingPages: Set<Int> = emptySet(),
    val total: Int = 0,
    /**
     * Sprungziel des Scrubbers — die laufende Nummer, zu der gescrollt werden
     * soll. Die Ansicht führt den Sprung aus und meldet ihn mit
     * catalogScrollConsumed() zurück; ohne das Zurücksetzen liesse sich
     * dasselbe Jahr kein zweites Mal anspringen.
     */
    val scrollTo: Int? = null,
    // Filter
    val query: String = "",
    val themeId: Int? = null,
    val year: Int? = null,
    val sort: Katalogsortierung = Katalogsortierung.VORGABE,
    // Meta
    val themes: List<KatalogThemaAnsicht> = emptyList(),
    val yearMin: Int? = null,
    val yearMax: Int? = null,
    /**
     * Wie viele Sets je Jahr, mit den aktuellen Filtern und in der Reihenfolge der
     * Liste — die Zahlen, aus denen die Leiste rechts ihr Etikett rechnet (siehe
     * CatalogYearMath), wie in der Webapp. Jahrgänge ohne Jahr sind schon weggeworfen,
     * ebenfalls wie dort.
     */
    val jahrVerteilung: List<JahrAnzahlAnsicht> = emptyList(),
    // Detail
    /** Ein Fehler steht hier statt des Kringels, mit Grund und „Erneut versuchen“. */
    val detail: Laden<KatalogDetailAnsicht> = Laden.Laedt,
)
