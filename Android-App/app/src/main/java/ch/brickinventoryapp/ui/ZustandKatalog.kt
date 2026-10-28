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
     * Geladene Seiten, nach Seitennummer.
     *
     * ── Warum eine Karte statt einer Liste (Nachtrag 86) ────────────────────
     * Marcos Vorgabe: Die Zeitleiste rechts soll nicht filtern, sondern
     * schnell scrollen — „kann nicht geprüft werden, wo man hinscrollt, und
     * dieser Teil wird dann geladen".
     *
     * Genau das geht mit einer angehängten Liste nicht: Wer auf Jahr 2005
     * springt, landet mitten im Bestand, und darüber wie darunter fehlt alles.
     * Die Ansicht führt deshalb ALLE `total` Plätze und lädt die Seite, die
     * gerade sichtbar wird — vorwärts wie rückwärts. Was noch nicht da ist,
     * steht als Platzhalter.
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
     * Wo die Liste stand, als man sie verlassen hat.
     *
     * ── Marcos Befund (Nachtrag 91) ─────────────────────────────────────────
     * „Wenn im Katalog eine Detailseite aufgerufen und wieder geschlossen wird,
     * ist der Scrollbalken ganz zuoberst und nicht an der Stelle von vor dem
     * Aufruf."
     *
     * Die Position lag im `LazyGridState` des Bildschirms. Die Detailseite ist
     * ein eigener Navigationspunkt — beim Wechsel verlässt die Liste die
     * Komposition, und was danach wiederhergestellt wird, hängt an Compose'
     * Speichermechanik. Bei einer Liste, deren Länge (`total`) und Inhalt
     * (`loadedPages`) erst nachträglich eintreffen, ist das nicht verlässlich:
     * Wird zum Zeitpunkt der Wiederherstellung noch nichts angezeigt, gibt es
     * keine Stelle, an die zurückgesprungen werden könnte.
     *
     * Im Zustand ist sie unabhängig davon — er lebt im ViewModel und überlebt
     * jeden Wechsel des Bildschirms.
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
     * Wie viele Sets je Jahr, MIT den aktuellen Filtern und in der Reihenfolge
     * der Liste — die Zahlen, aus denen die Leiste rechts ihr Etikett rechnet.
     *
     * Ohne sie stand dort eine lineare Schaetzung (siehe CatalogYearMath): Der
     * Katalog stammt weit ueberwiegend aus den letzten Jahrzehnten, und wer
     * neun Zehntel hinunterzieht, ist deshalb noch lange nicht bei den
     * Sechzigern. Die Webapp rechnet seit Marcos Meldung mit dieser
     * Verteilung; hier steht sie aus demselben Grund.
     *
     * Jahrgaenge OHNE Jahr sind schon weggeworfen — genau wie in der Webapp.
     */
    val jahrVerteilung: List<ch.brickinventoryapp.data.model.JahrAnzahl> = emptyList(),
    // `yearCounts` (Anzahl Sets je Jahr) stand hier, wurde aus der
    // Katalog-Metaantwort gefuellt und nirgends angezeigt. Der Wert steht
    // weiterhin in CatalogMetaResponse; wer ein Jahres-Histogramm bauen will,
    // holt ihn von dort. Gefunden von derselben Regel.
    // Detail
    val detail: CatalogSetDetail? = null,
    val detailLoading: Boolean = false,
)
