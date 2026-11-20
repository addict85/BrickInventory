package ch.brickinventoryapp.catalog.ui.screens

import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.domain.Katalogsortierung
import androidx.compose.material.icons.automirrored.filled.MenuBook
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.NoHitsHint
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.StateHint
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import ch.brickinventoryapp.ui.components.focusFrame
import ch.brickinventoryapp.catalog.ui.viewmodel.KatalogAktionen
import ch.brickinventoryapp.ui.components.SkeletonRaster
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.KatalogZiel
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import coil3.ImageLoader
import androidx.compose.ui.graphics.Color
import ch.brickinventoryapp.data.repository.CATALOG_PAGE_SIZE
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.ReadableColumns
import ch.brickinventoryapp.ui.components.withFont

/**
 * Katalog-Screen: gesamter Rebrickable-Set-Katalog, serverseitig paginiert.
 * Aufbau analog GalleryScreen (Suche oben, Filter-Chips, Grid) — Filter
 * laufen aber serverseitig, das Grid lädt beim Scrollen seitenweise nach.
 */
@Composable
internal fun CatalogRoute(
    katalog: CatalogViewModel,
    serverUrl: String,
    imageLoader: ImageLoader,
    rollgedaechtnis: ScrollMemory,
    onSetClick: (String) -> Unit,
) {
    val state by katalog.state.collectAsStateWithLifecycle()
    CatalogScreen(state, serverUrl, katalog, imageLoader, onSetClick, rollgedaechtnis)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogScreen(
    state: CatalogUiState,
    serverUrl: String,
    katalog: KatalogAktionen,
    imageLoader: ImageLoader,
    /** Klick auf ein Set — nur der Graph kennt den NavController. */
    onSetClick: (String) -> Unit,
    /** Die eine Quelle der Rollstelle, dieselbe wie bei den anderen Reitern. */
    rollgedaechtnis: ScrollMemory = remember { ScrollMemory() },
) {
    val onQueryChange: (String) -> Unit = { q -> katalog.setCatalogQuery(q) }
    val onThemeChange: (Int?) -> Unit = { t -> katalog.setCatalogTheme(t) }
    val onYearChange: (Int?) -> Unit = { y -> katalog.setCatalogYear(y) }
    val onSortChange: (Katalogsortierung) -> Unit = { srt -> katalog.setCatalogSort(srt) }
    /** Das sichtbare Fenster melden; das ViewModel lädt, sobald die Liste ruht. */
    val onVisible: (Int, Int) -> Unit = { von, bis -> katalog.catalogVisible(von, bis) }
    /** Die Leiste rechts rollt die Liste an eine Stelle — ohne zu filtern. */
    val onScrollTo: (Int) -> Unit = { nummer -> katalog.scrollCatalogTo(nummer) }
    /** Meldet, dass der Sprung ausgeführt wurde. */
    val onScrollConsumed: () -> Unit = { katalog.catalogScrollConsumed() }
    val onRefresh: () -> Unit = { katalog.loadCatalogMeta(); katalog.loadCatalogSets() }

    // Als State-Objekte statt per `by`: CatalogFilterRow() setzt sie und braucht
    // dasselbe Objekt, keine Kopie.
    val showThemeSheet = remember { mutableStateOf(false) }
    val showYearSheet  = remember { mutableStateOf(false) }

    // Ein Zustand je Besuch; die Stelle hält der ScrollMemory. Die Plätze zählen über
    // `total`, deshalb ist die Liste bereit, sobald die Länge da ist.
    val gridState = remember { LazyGridState() }
    ScrollPositionKeeper(KatalogZiel.Catalog.rollSchluessel, gridState, bereit = state.total > 0, speicher = rollgedaechtnis)

    // Die Liste führt alle `total` Plätze; geladen wird die Seite eines sichtbar gewordenen
    // Platzes, mit einer Seite Vorlauf — so kann die Leiste rechts überallhin springen.
    LaunchedEffect(gridState, state.total, state.loadedPages.size) {
        snapshotFlow {
            val sichtbar = gridState.layoutInfo.visibleItemsInfo
            val firstPage = ((sichtbar.firstOrNull()?.index ?: 0) / CATALOG_PAGE_SIZE) + 1
            val lastPage = ((sichtbar.lastOrNull()?.index ?: 0) / CATALOG_PAGE_SIZE) + 1
            firstPage to lastPage
        }.collect { (von, bis) -> onVisible(von, bis) }
    }

    // Kein eigener Sprung-Abruf daneben: Beide Wege — Rollen und Leiste — enden im
    // Sichtfenster-Lader oben, und dessen Ruhe deckt beide ab. Zwei Fassungen
    // derselben Regel liefen auseinander.

    // Der Griff der Leiste hängt an der Stelle in der Liste wie ein Scrollbalken, wie
    // in der Webapp: gridState.firstVisibleItemIndex ist die Stelle, das Jahr dazu
    // liefert die Verteilung (CatalogYearMath).

    // Sprungziel des Scrubbers ausführen.
    LaunchedEffect(state.scrollTo) {
        state.scrollTo?.let { ziel ->
            gridState.scrollToItem(ziel.coerceIn(0, (state.total - 1).coerceAtLeast(0)))
            onScrollConsumed()
        }
    }

    val selectedThemeName = state.themes.firstOrNull { it.id == state.themeId }?.name
        ?.substringAfterLast(" › ")

    // Rechts Platz nur, wenn die Jahres-Leiste dort steht; sonst gleiche Ränder links und rechts.
    val withYearsBar = state.sort.afterYear && state.yearDistribution.isNotEmpty()
    val rasterEdge = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel, bottom = Abstaende.mittel,
        end = if (withYearsBar) TRACK_WIDTH else Abstaende.mittel)
    val gefiltert = state.query.isNotBlank() || state.themeId != null || state.year != null
    val fehler = state.abruf as? Laden.Fehler
    val laedt = state.abruf.laedt
    Column(Modifier.fillMaxSize()) {
        CatalogSearchField(state, onQueryChange, onSortChange)
        CatalogFilterRow(state, selectedThemeName, showThemeSheet, showYearSheet)
        // Trefferzahl — nicht im Fehlerfall: „0 Sets im Katalog“ stand dort neben dem Fehler.
        if (fehler == null || state.total > 0) Text(
            // pluralStringResource statt stringResource: „1 Set im Katalog",
            // nicht „1 Sets".
            pluralStringResource(R.plurals.catalog_result_count, state.total, state.total),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.hairline)
        )

        androidx.compose.material3.pulltorefresh.PullToRefreshBox(
            isRefreshing = laedt && state.total > 0,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize()
        ) {
            when {
                // Dieselben Masse wie das Raster darunter, damit beim Eintreffen nichts springt.
                laedt && state.total == 0 -> SkeletonRaster(
                    ReadableColumns(160.dp), kachelHoehe = 200.dp, innenabstand = rasterEdge,
                )
                // Derselbe Fehlerzustand wie Galerie, Teile und Merkliste.
                fehler != null && state.total == 0 -> StateHint {
                    ErrorHint(fehler.meldung.satz(), onRefresh, fehler.art)
                }
                // Mit Suche oder Filter: sagen, woran es liegt, und den Weg zurück anbieten.
                state.total == 0 && gefiltert -> StateHint {
                    NoHitsHint(stringResource(R.string.catalog_no_results))
                    Button(onClick = {
                        if (state.query.isNotBlank()) onQueryChange("")
                        if (state.themeId != null) onThemeChange(null)
                        if (state.year != null) onYearChange(null)
                    }) { Text(stringResource(R.string.filter_reset_all)) }
                }
                state.total == 0 -> StateHint {
                    HintText(Icons.AutoMirrored.Filled.MenuBook, stringResource(R.string.catalog_leer_titel),
                        stringResource(R.string.catalog_leer_text))
                    Button(onClick = onRefresh) { Text(stringResource(R.string.common_retry)) }
                }
                else -> Box(Modifier.fillMaxSize()) {
                    LazyVerticalGrid(
                        state = gridState,
                        columns = ReadableColumns(160.dp),
                        contentPadding = rasterEdge,
                        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        verticalArrangement = Arrangement.spacedBy(Abstaende.klein)
                    ) {
                        // Ein Platz je Set im ganzen Ergebnis — auch für das,
                        // was noch nicht geladen ist. Der Schlüssel ist die
                        // Position, nicht die Setnummer: Ein Platzhalter hat
                        // noch keine.
                        items(count = state.total, key = { it }) { index ->
                            val seite = index / CATALOG_PAGE_SIZE + 1
                            val set = state.loadedPages[seite]?.getOrNull(index % CATALOG_PAGE_SIZE)
                            if (set != null) CatalogSetCard(set, imageLoader, serverUrl, onSetClick, index)
                            else CatalogPlaceholderCard()
                        }
                    }
                    // Die Jahres-Leiste ist Schnell-Scroll, kein Filter: Ziehen rollt die Liste,
                    // das Etikett zeigt das Jahr der Stelle. Nur bei Sortierung nach Jahr, wie in
                    // der Webapp — sonst liegen die Jahre verstreut. firstVisibleItemIndex in
                    // derivedStateOf gelesen, damit der Bildschirm nur bei einer Änderung des
                    // abgeleiteten Werts neu auswertet (Lint FrequentlyChangingValue).
                    val visibleNumber by remember(gridState) {
                        derivedStateOf { gridState.firstVisibleItemIndex }
                    }
                    if (withYearsBar && state.total > 0) {
                        YearScrubber(
                            listenNummer = visibleNumber,
                            total = state.total,
                            verteilung = state.yearDistribution,
                            // Erste Wahl wie in der Webapp: das Jahr der
                            // Kachel, die an dieser Stelle steht. Genau diese
                            // Rechnung stand vorher weiter oben im Bildschirm
                            // und hiess `sichtbaresJahr`.
                            jahrGeladen = { nummer ->
                                state.loadedPages[nummer / CATALOG_PAGE_SIZE + 1]
                                    ?.getOrNull(nummer % CATALOG_PAGE_SIZE)?.year
                            },
                            // Nur ROLLEN, nicht laden: Was an der neuen Stelle
                            // gebraucht wird, holt der Sichtfenster-Lader —
                            // entprellt, siehe oben. Ein Abruf an dieser Stelle
                            // liefe bei JEDEM Beruehrungspunkt.
                            onScrollTo = onScrollTo,
                            modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight()
                        )
                    }
                }
            }
        }
    }

    // ── Thema-Auswahl (BottomSheet: durchsuchbare Liste) ─────────────────────
    CatalogThemeSheet(state, showThemeSheet, onThemeChange)
    CatalogYearSheet(state, showYearSheet, onYearChange)
}

/** Eine Zeile der Themen- und Jahreswahl; öffentlich, damit der Barrierefreiheitstest sie zeigen kann. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThemeRow(label: String, selected: Boolean, onClick: () -> Unit) {
    // Ein Optionsfeld: TalkBack nennt Rolle und Wahl, das Häkchen allein sah nur, wer sieht.
    Surface(
        selected = selected,
        onClick = onClick,
        shape = Formen.kachel,
        color = if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
                else androidx.compose.ui.graphics.Color.Transparent,
        modifier = Modifier.fillMaxWidth().focusFrame(Formen.kachel).semantics { role = Role.RadioButton }
    ) {
        Row(
            Modifier.padding(horizontal = Abstaende.mittel, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (selected) Icon(Icons.Default.Check, null, Modifier.size(withFont(18.dp)), tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
/** Beschriftung einer Sortierung; vollständig, damit ein neuer Wert hier auffällt. */
internal fun Katalogsortierung.beschriftung(): String = stringResource(when (this) {
    Katalogsortierung.JAHR_ABSTEIGEND -> R.string.catalog_sort_year_desc
    Katalogsortierung.JAHR_AUFSTEIGEND -> R.string.catalog_sort_year_asc
    Katalogsortierung.NAME -> R.string.catalog_sort_name
    Katalogsortierung.NUMMER -> R.string.catalog_sort_number
    Katalogsortierung.TEILE_ABSTEIGEND -> R.string.catalog_sort_parts_desc
    Katalogsortierung.TEILE_AUFSTEIGEND -> R.string.catalog_sort_parts_asc
})
