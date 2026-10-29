package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * Katalog-Zustand — eigener Flow (wie SetDetail/CsvImport): Suche und
 * Paging aktualisieren häufig; als Teil von AppUiState würde jede
 * Katalog-Seite die gesamte App rekomponieren.
 */
data class CatalogUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    /**
     * Geladene Seiten, nach Seitennummer. Eine Karte statt einer Liste, weil die
     * Zeitleiste rechts schnell scrollt statt filtert: Wer auf 2005 springt, landet
     * mitten im Bestand. Die Ansicht führt deshalb alle `total` Plätze und lädt die
     * Seite, die gerade sichtbar wird — vorwärts wie rückwärts; was noch fehlt, steht
     * als Platzhalter.
     */
    val loadedPages: Map<Int, List<CatalogSetItem>> = emptyMap(),
    val loadingPages: Set<Int> = emptySet(),
    val total: Int = 0,
    /**
     * Sprungziel des Scrubbers — die laufende Nummer, zu der gescrollt werden
     * soll. Die Ansicht führt den Sprung aus und meldet ihn mit
     * catalogScrollConsumed() zurück; ohne das Zurücksetzen liesse sich
     * dasselbe Jahr kein zweites Mal anspringen.
     */
    val scrollTo: Int? = null,
    /**
     * Wo die Liste stand, als man sie verlassen hat. Im ViewModel statt im
     * `LazyGridState`: Die Detailseite ist ein eigener Navigationspunkt, und bei einer
     * Liste, deren Länge (`total`) und Inhalt (`loadedPages`) erst nachträglich
     * eintreffen, gäbe es beim Wiederherstellen noch keine Stelle, an die
     * zurückgesprungen werden könnte.
     */
    val scrollIndex: Int = 0,
    val scrollOffset: Int = 0,
    // Filter
    val query: String = "",
    val themeId: Int? = null,
    val year: Int? = null,
    val sort: String = "year_desc",
    // Meta
    val themes: List<CatalogTheme> = emptyList(),
    val yearMin: Int? = null,
    val yearMax: Int? = null,
    /**
     * Wie viele Sets je Jahr, mit den aktuellen Filtern und in der Reihenfolge der
     * Liste — die Zahlen, aus denen die Leiste rechts ihr Etikett rechnet (siehe
     * CatalogYearMath), wie in der Webapp. Jahrgänge ohne Jahr sind schon weggeworfen,
     * ebenfalls wie dort.
     */
    val jahrVerteilung: List<ch.brickinventoryapp.data.model.JahrAnzahl> = emptyList(),
    // Detail
    val detail: CatalogSetDetail? = null,
    val detailLoading: Boolean = false,
)
