package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.SkelettRaster
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.CatalogSetItem
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.collectLatest
import ch.brickinventoryapp.ui.CatalogUiState
import ch.brickinventoryapp.ui.AppViewModel
import ch.brickinventoryapp.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.CatalogYearMath
import ch.brickinventoryapp.ui.theme.BrickStudCap
import ch.brickinventoryapp.ui.theme.NoppenReihe
import ch.brickinventoryapp.ui.theme.SteinKantenVerlauf
import ch.brickinventoryapp.ui.theme.NoppenMass
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.LocalIsNoppeTheme
import ch.brickinventoryapp.ui.theme.LocalIstGlanz
import ch.brickinventoryapp.ui.theme.LichtStreifen
import ch.brickinventoryapp.ui.theme.steinTon
import ch.brickinventoryapp.ui.theme.LocalIsFarbfaecherTheme
import ch.brickinventoryapp.ui.theme.faecherTon
import ch.brickinventoryapp.util.rememberTileImageWithFallback
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import ch.brickinventoryapp.data.repository.CATALOG_PAGE_SIZE
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.LeerSymbol

/**
 * Wie lange die Liste ruhig stehen muss, bevor ihre sichtbaren Seiten geholt
 * werden: 150 ms wie in der Webapp (`_ladeSichtbareSeiten`). Beim Scrollen merkt
 * man sie nicht, ein Zug über die ganze Leiste fällt auf einen Abruf zusammen;
 * kürzer als ein Berührungsabstand entprellte sie nichts.
 */
private const val SICHTFENSTER_RUHE_MS = 150L

/**
 * Katalog-Screen: gesamter Rebrickable-Set-Katalog, serverseitig paginiert.
 * Aufbau analog GalleryScreen (Suche oben, Filter-Chips, Grid) — Filter
 * laufen aber serverseitig, das Grid lädt beim Scrollen seitenweise nach.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogScreen(
    vm: AppViewModel,
    katalog: CatalogViewModel,
    imageLoader: ImageLoader,
    /** Klick auf ein Set — nur der Graph kennt den NavController. */
    onSetClick: (String) -> Unit,
) {
    // Zustand und Aktionen vom ViewModel statt über Parameter — dasselbe Muster wie
    // Galerie, Finanzen, Teile und Minifiguren.
    val state by katalog.state.collectAsStateWithLifecycle()
    val appState by vm.state.collectAsStateWithLifecycle()

    val serverUrl = appState.serverUrl

    val onQueryChange: (String) -> Unit = { q -> katalog.setCatalogQuery(q) }
    val onThemeChange: (Int?) -> Unit = { t -> katalog.setCatalogTheme(t) }
    val onYearChange: (Int?) -> Unit = { y -> katalog.setCatalogYear(y) }
    val onSortChange: (String) -> Unit = { srt -> katalog.setCatalogSort(srt) }
    /** Eine Seite laden, die gerade ins Bild kommt (vorwärts wie rückwärts). */
    val onEnsurePage: (Int) -> Unit = { seite -> katalog.ensureCatalogPage(seite) }
    /** Die Leiste rechts rollt die Liste an eine Stelle — ohne zu filtern. */
    val onScrollTo: (Int) -> Unit = { nummer -> katalog.scrollCatalogTo(nummer) }
    /** Meldet, dass der Sprung ausgeführt wurde. */
    val onScrollConsumed: () -> Unit = { katalog.catalogScrollConsumed() }
    /** Meldet die Rollposition, damit sie den Wechsel zur Detailseite überlebt. */
    val onScrollPos: (Int, Int) -> Unit = { index, offset -> katalog.setCatalogScrollPos(index, offset) }
    val onRefresh: () -> Unit = { katalog.loadCatalogMeta(); katalog.loadCatalogSets() }

    // Als State-Objekte statt per `by`: CatalogFilterRow() setzt sie und braucht
    // dasselbe Objekt, keine Kopie.
    val showThemeSheet = remember { mutableStateOf(false) }
    val showYearSheet  = remember { mutableStateOf(false) }
    val showSortMenu   = remember { mutableStateOf(false) }

    val gridState = rememberLazyGridState()

    // ── Laden, was gerade sichtbar wird ──
    //
    // Die Liste führt alle `total` Plätze; geladen wird die Seite eines sichtbar
    // gewordenen Platzes, mit einer Seite Vorlauf — so kann die Leiste rechts
    // überallhin springen. Erst wenn die Liste ruht: Die Leiste rollt beim Ziehen
    // durch jede Zwischenposition, und ohne Ruhe stünde die Zielseite hinter Hunderten
    // angeforderter Seiten in der Schlange.
    LaunchedEffect(gridState, state.total, state.loadedPages.size) {
        snapshotFlow {
            val sichtbar = gridState.layoutInfo.visibleItemsInfo
            val ersteSeite = ((sichtbar.firstOrNull()?.index ?: 0) / CATALOG_PAGE_SIZE) + 1
            val letzteSeite = ((sichtbar.lastOrNull()?.index ?: 0) / CATALOG_PAGE_SIZE) + 1
            ersteSeite to letzteSeite
        }.collectLatest { (von, bis) ->
            // `collectLatest`, nicht `collect`: Trifft waehrend der Wartezeit
            // ein neues Sichtfenster ein, bricht Kotlin diesen Durchlauf ab.
            // Mit `collect` wuerde jeder Punkt des Zuges nur VERZOEGERT
            // geladen statt gar nicht — die Abrufe blieben dieselben.
            kotlinx.coroutines.delay(SICHTFENSTER_RUHE_MS)
            for (seite in (von - 1)..(bis + 1)) if (seite >= 1) onEnsurePage(seite)
        }
    }

    // Kein eigener Sprung-Abruf daneben: Beide Wege — Rollen und Leiste — enden im
    // Sichtfenster-Lader oben, und dessen Ruhe deckt beide ab. Zwei Fassungen
    // derselben Regel liefen auseinander.


    // ── Die Rollposition überlebt den Wechsel zur Detailseite ──
    //
    // Die Liste verlässt beim Wechsel die Komposition und ihre Länge trifft erst
    // später ein, deshalb hilft Compose' Wiederherstellung nicht. Die Stelle steht im
    // Zustand (ViewModel); beim Betreten wird einmal zurückgesprungen, sobald die
    // Länge da ist, und erst danach gemeldet — sonst überschriebe die frische Null die
    // gemerkte Stelle. `remember`, nicht `rememberSaveable`: Der Merker gilt je
    // Komposition; überlebte er den Ausflug, spränge die Rückkehr nie mehr zurück.
    var wiederhergestellt by remember { mutableStateOf(false) }
    LaunchedEffect(state.total) {
        if (wiederhergestellt || state.total == 0) return@LaunchedEffect
        if (state.scrollIndex > 0) {
            gridState.scrollToItem(
                state.scrollIndex.coerceIn(0, (state.total - 1).coerceAtLeast(0)),
                state.scrollOffset
            )
        }
        wiederhergestellt = true
    }
    LaunchedEffect(gridState, wiederhergestellt) {
        if (!wiederhergestellt) return@LaunchedEffect
        snapshotFlow { gridState.firstVisibleItemIndex to gridState.firstVisibleItemScrollOffset }
            .collect { (index, offset) -> onScrollPos(index, offset) }
    }

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

    Column(Modifier.fillMaxSize()) {

        CatalogSearchField(state, onQueryChange)
        CatalogFilterRow(state, selectedThemeName, showThemeSheet, showYearSheet, showSortMenu, onSortChange)
        // Trefferzahl
        Text(
            // pluralStringResource statt stringResource: „1 Set im Katalog",
            // nicht „1 Sets".
            pluralStringResource(R.plurals.catalog_result_count, state.total, state.total),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.haar)
        )

        androidx.compose.material3.pulltorefresh.PullToRefreshBox(
            isRefreshing = state.isLoading && state.total > 0,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize()
        ) {
            // In eine lokale Variable gehoben, damit der Smart Cast greift: `state` ist
            // delegiert, jeder Zugriff ruft getValue(). Kein `?: ""` — ein leerer Fehlertext
            // verschwiege die Ursache.
            val fehlertext = state.error
            when {
                // Dieselben Masse wie das Raster darunter, damit beim Eintreffen nichts springt.
                state.isLoading && state.total == 0 -> SkelettRaster(
                    GridCells.Adaptive(160.dp), kachelHoehe = 200.dp,
                    innenabstand = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel,
                                                 bottom = Abstaende.mittel, end = 30.dp),
                )
                fehlertext != null && state.total == 0 -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                        LeerSymbol(Icons.Default.ErrorOutline)
                        Text(fehlertext, fontWeight = FontWeight.SemiBold)
                        Button(onClick = onRefresh, shape = Formen.knopf) { Text(stringResource(R.string.gallery_refresh)) }
                    }
                }
                state.total == 0 -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                        LeerSymbol(Icons.Default.SearchOff)
                        Text(stringResource(R.string.catalog_no_results), fontWeight = FontWeight.SemiBold)
                    }
                }
                else -> Box(Modifier.fillMaxSize()) {
                    LazyVerticalGrid(
                        state = gridState,
                        columns = GridCells.Adaptive(160.dp),
                        contentPadding = PaddingValues(start = Abstaende.mittel, top = Abstaende.mittel, bottom = Abstaende.mittel, end = 30.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
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
                    val sichtbareNummer by remember(gridState) {
                        derivedStateOf { gridState.firstVisibleItemIndex }
                    }
                    if (state.sort.startsWith("year_") && state.total > 0
                        && state.jahrVerteilung.isNotEmpty()) {
                        YearScrubber(
                            listenNummer = sichtbareNummer,
                            total = state.total,
                            verteilung = state.jahrVerteilung,
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

/**
 * Die Jahres-Leiste am rechten Rand, wie in der Webapp. Position ist die Stelle in
 * der Liste, nicht ein linear verteiltes Jahr: Der Katalog stammt überwiegend aus
 * den letzten Jahrzehnten, und das Etikett soll das Jahr zeigen, das an dieser
 * Stelle wirklich liegt (CatalogYearMath.jahrAnPosition). Als Row, damit das
 * Etikett über die Kacheln ragen kann, ohne Berührungen abzufangen.
 */
@Composable
private fun YearScrubber(
    /** Stelle in der Liste, an der die Anzeige gerade steht (0 .. total-1). */
    listenNummer: Int,
    total: Int,
    verteilung: List<ch.brickinventoryapp.data.model.JahrAnzahl>,
    /** Jahr der Kachel an einer laufenden Nummer — null, wenn nicht geladen. */
    jahrGeladen: (Int) -> Int?,
    /** Ziehen: zu dieser Stelle rollen. Laeuft waehrend der Bewegung, nicht erst am Ende. */
    onScrollTo: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var dragging by remember { mutableStateOf(false) }
    var ziehAnteil by remember { mutableStateOf(0f) }
    var heightPx by rememberSaveable { mutableStateOf(1) }
    val thumbHeightPx = with(LocalDensity.current) { 36.dp.roundToPx() }

    // Beim Ziehen zeigt der Griff, WOHIN es geht; sonst, WO die Liste steht.
    // Der zweite Fall fehlte in der vorigen Fassung ganz — der Griff stand
    // dauerhaft dort, wo zuletzt gezogen worden war.
    val anteil = if (dragging) ziehAnteil else CatalogYearMath.anteilAusNummer(listenNummer, total)
    val thumbOffsetY = CatalogYearMath.daumenOffset(anteil, heightPx, thumbHeightPx)
    val etikett = CatalogYearMath.jahrFuer(anteil, total, verteilung, jahrGeladen)

    /** Beruehrung -> Anteil -> rollen. Wie js/15-scrollbar.js -> rollen(). */
    fun rollen(y: Float) {
        ziehAnteil = CatalogYearMath.anteilAus(y, heightPx, thumbHeightPx)
        onScrollTo(CatalogYearMath.nummerAus(ziehAnteil, total))
    }

    Row(modifier) {
        // Etikett-Spur — nur sichtbar beim Ziehen, faengt keine Beruehrungen.
        Box(Modifier.fillMaxHeight()) {
            if (dragging && etikett != null) {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                    shape = Formen.marke,
                    shadowElevation = 3.dp,
                    modifier = Modifier
                        .offset { IntOffset(0, thumbOffsetY) }
                        .padding(end = 6.dp)
                ) {
                    Text(
                        "$etikett",
                        fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp)
                    )
                }
            }
        }

        // Gesten-Leiste (28dp) mit Schiene + Griff
        Box(
            Modifier
                .width(28.dp)
                .fillMaxHeight()
                .onSizeChanged { heightPx = it.height }
                .pointerInput(total) {
                    detectVerticalDragGestures(
                        onDragStart = { offset -> dragging = true; rollen(offset.y) },
                        onVerticalDrag = { change, _ -> change.consume(); rollen(change.position.y) },
                        onDragEnd = { dragging = false },
                        onDragCancel = { dragging = false }
                    )
                }
                .pointerInput(total) {
                    // Neben den Griff getippt: dorthin springen — wie bei einem
                    // gewoehnlichen Scrollbalken.
                    detectTapGestures { offset -> rollen(offset.y) }
                }
        ) {
            // Schiene
            Surface(
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f),
                shape = Formen.strich,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 11.dp, top = 6.dp, bottom = 6.dp)
                    .width(3.dp)
                    .fillMaxHeight()
            ) {}

            // Griff — immer sichtbar, folgt der Liste
            Surface(
                color = if (dragging) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.primary.copy(alpha = 0.55f),
                shape = RoundedCornerShape(topStart = 10.dp, bottomStart = 10.dp),
                shadowElevation = if (dragging) 3.dp else 1.dp,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset { IntOffset(0, thumbOffsetY) }
            ) {
                Box(Modifier.width(18.dp).height(36.dp), Alignment.Center) {
                    if (LocalIsBrickTheme.current) {
                        // Stein-Design: Griff als Noppe (heller Stud-Punkt)
                        Surface(
                            color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.55f),
                            shape = androidx.compose.foundation.shape.CircleShape,
                            modifier = Modifier.size(8.dp)
                        ) {}
                    } else {
                        Icon(
                            Icons.Default.UnfoldMore, null,
                            tint = MaterialTheme.colorScheme.onPrimary,
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
/**
 * `internal`, weil der Aufrufer in einer anderen Datei steht und `private` in
 * Kotlin dateiweit gilt.
 */
internal fun ThemeRow(label: String, id: Int?, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = Formen.kachel,
        color = if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
                else androidx.compose.ui.graphics.Color.Transparent,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            Modifier.padding(horizontal = Abstaende.mittel, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (selected) Icon(Icons.Default.Check, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
/**
 * `internal`, weil der Aufrufer in einer anderen Datei steht und `private` in
 * Kotlin dateiweit gilt.
 */
internal fun sortLabel(sort: String): String = when (sort) {
    "year_asc"   -> stringResource(R.string.catalog_sort_year_asc)
    "name_asc"   -> stringResource(R.string.catalog_sort_name)
    "num_asc"    -> stringResource(R.string.catalog_sort_number)
    "parts_desc" -> stringResource(R.string.catalog_sort_parts_desc)
    "parts_asc"  -> stringResource(R.string.catalog_sort_parts_asc)
    else         -> stringResource(R.string.catalog_sort_year_desc)
}

@Composable
fun CatalogSetCard(
    set: CatalogSetItem,
    imageLoader: ImageLoader,
    serverUrl: String,
    onClick: (String) -> Unit,
    /** Position in der Kachelwand — nur fuer die Deckelfarbe des Designs "noppe". */
    position: Int = 0
) {
    val ctx = LocalContext.current
    val isBrick = LocalIsBrickTheme.current
    val istNoppe = LocalIsNoppeTheme.current
    val istGlanz = LocalIstGlanz.current
    // Der Thementon des Designs "farbfaecher" — dieselbe Rechnung wie
    // --faecher-ton in js/09-catalog.js. Ohne Thema-Nummer gibt es keinen
    // Streifen, statt eines falschen.
    val ton = if (LocalIsFarbfaecherTheme.current) faecherTon(set.themeId) else null
    // Die Noppen stehen über der Karte: Eine Material-Card klippt auf ihre Form.
    // Deshalb rückt die Karte um die Noppenhöhe nach unten, und die Reihe wird daneben
    // gezeichnet und darübergelegt — wie `top:-6px` im CSS.
    Box {
        AppKarte(
            modifier = Modifier.heightIn(min = 212.dp)
                .then(if (isBrick) Modifier.padding(top = NoppenMass.Stein.hoehe) else Modifier),
            onClick = { onClick(set.setNumber) }
        ) {
            Column {
                // Die Steinkante mit den Massen aus themes/brick.css (NoppenMass.Stein), wie im
                // Web über die ganze Breite. Nur die Kante liegt in der Karte; die Noppen werden
                // daneben gezeichnet, weil die Card sie abschnitte.
                if (isBrick) BrickStudCap(
                    mass = NoppenMass.Stein,
                    verlauf = SteinKantenVerlauf,
                )
                // Der Steindeckel des Designs "noppe" — Position modulo sechs,
                // genau wie `.sc:nth-child(6n+…)` in themes/noppe.css. Dieselbe
                // Bauform wie beim Stein-Design, nur hoeher und in wechselnder
                // Farbe; deshalb derselbe Baustein statt eines zweiten.
                if (istNoppe) BrickStudCap(color = steinTon(position), glanz = istGlanz)
                if (ton != null) {
                    Box(Modifier.fillMaxWidth().height(5.dp).background(ton))
                }
                Box(Modifier.fillMaxWidth().height(if (isBrick) 92.dp else 118.dp)) {
                    // Über den Server auflösen statt roher CDN-Adresse: Hat schon jemand das
                    // Katalog-Set heruntergeladen, kommt das Bild von dort. Scheitert die Vorschau,
                    // Rückfall auf die volle Auflösung vor dem Platzhalter.
                    val (thumbUrl, onThumbError) = rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)
                    if (thumbUrl != null) {
                        AsyncImage(
                            model = ImageRequest.Builder(ctx).data(thumbUrl).crossfade(true).build(),
                            imageLoader = imageLoader,
                            contentDescription = set.name,
                            // onError statt onState: mit "imageLoader" UND "error"
                            // (Platzhalter-Painter) gehört der Aufruf zur
                            // Painter-Überladung von AsyncImage, die "onState"
                            // nicht kennt — nur "onError" als eigener Parameter.
                            onError = { onThumbError() },
                            // Kaputte/fehlende CDN-Bilder -> Logo-Platzhalter statt leerer Fläche
                            error = painterResource(R.drawable.ic_logo),
                            modifier = Modifier.fillMaxSize()
                                .then(if (isBrick) Modifier else Modifier.clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))),
                            contentScale = ContentScale.Fit
                        )
                    } else {
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            Image(painterResource(R.drawable.ic_logo), null, Modifier.size(48.dp))
                        }
                    }
                    if (set.owned) {
                        Surface(
                            color = MaterialTheme.colorScheme.primary,
                            shape = RoundedCornerShape(bottomStart = 10.dp),
                            modifier = Modifier.align(Alignment.TopEnd)
                        ) {
                            Text(
                                if (set.ownedQuantity > 1) "✓ ×${set.ownedQuantity}" else "✓",
                                color = MaterialTheme.colorScheme.onPrimary,
                                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp)
                            )
                        }
                    }
                    // Die Spiegelung auf der Glasscheibe. ZULETZT im Box, damit sie
                    // ueber dem Bild liegt — und nur hier, nicht ueber der ganzen
                    // Kachel: Ein weisser Schleier ueber weissem Text ist kein
                    // Glanz, sondern Grau (siehe LichtStreifen in BrickDecor.kt).
                    if (istGlanz) Box(Modifier.matchParentSize().background(LichtStreifen))
                }
                Column(Modifier.padding(horizontal = 10.dp, vertical = 7.dp)) {
                    Text(set.setNumber, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                    Text(set.name ?: "—", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                        maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 16.sp)
                    Spacer(Modifier.weight(1f))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("${set.year ?: "—"}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if ((set.numParts ?: 0) > 0) {
                            // Dasselbe Teile-Symbol wie im Reiter „Teile" und in der
                            // Webapp, statt des Puzzleteil-Emojis: Ein Puzzleteil hat
                            // mit LEGO nichts zu tun, und die Darstellung eines Emojis
                            // hängt an der Schriftart des Geräts.
                            Icon(
                                ImageVector.vectorResource(R.drawable.ic_parts_bricks),
                                contentDescription = null,
                                tint = Color.Unspecified,
                                modifier = Modifier.size(13.dp)
                            )
                            Text("${set.numParts}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
        if (isBrick) NoppenReihe(
            mass = NoppenMass.Stein,
            modifier = Modifier.align(Alignment.TopStart),
            farbe = ch.brickinventoryapp.ui.theme.LocalSteinDekor.current.noppen,
        )
    }
}


/**
 * Platzhalter für einen Platz, dessen Seite noch nicht geladen ist — gleich hoch
 * wie eine echte Kachel, sonst springt die Liste beim Eintreffen, und ein Sprung
 * an eine Jahresgrenze landete daneben.
 */
@Composable
private fun CatalogPlaceholderCard() {
    Card(
        shape = Formen.leiste,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)),
        modifier = Modifier.fillMaxWidth().height(200.dp)
    ) {}
}
