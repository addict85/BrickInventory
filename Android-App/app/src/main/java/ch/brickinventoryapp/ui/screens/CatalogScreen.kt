package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.Image
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
import ch.brickinventoryapp.ui.CatalogUiState
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.viewmodel.CatalogViewModel
import ch.brickinventoryapp.ui.*  // Feature-Extensions (setCatalogQuery, loadCatalogSets, …)
import ch.brickinventoryapp.ui.CatalogYearMath
import ch.brickinventoryapp.ui.theme.BrickStudCap
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.util.rememberTileImageWithFallback
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.request.ImageRequest
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import ch.brickinventoryapp.data.repository.CATALOG_PAGE_SIZE

/**
 * Katalog-Screen: gesamter Rebrickable-Set-Katalog, serverseitig paginiert.
 * Aufbau analog GalleryScreen (Suche oben, Filter-Chips, Grid) — Filter
 * laufen aber serverseitig, das Grid lädt beim Scrollen seitenweise nach.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogScreen(
    vm: MainViewModel,
    katalog: CatalogViewModel,
    imageLoader: ImageLoader,
    /** Klick auf ein Set — nur der Graph kennt den NavController. */
    onSetClick: (String) -> Unit,
) {
    // Zustand und Aktionen vom ViewModel statt über dreizehn Parameter —
    // dasselbe Muster wie in Galerie/Finanzen/Teile/Minifiguren (Nachtrag 96).
    // Die Namen darunter bleiben absichtlich dieselben, damit der Rumpf
    // unverändert ist.
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

    // Als State-Objekte statt per `by`: CatalogFilterRow() setzt sie, und dafür
    // muss es dasselbe Objekt sein, keine Kopie (Nachtrag 98).
    val showThemeSheet = remember { mutableStateOf(false) }
    val showYearSheet  = remember { mutableStateOf(false) }
    val showSortMenu   = remember { mutableStateOf(false) }

    val gridState = rememberLazyGridState()

    // ── Laden, was gerade sichtbar wird ─────────────────────────────────────
    //
    // Kein Endlos-Scroll mehr, der nur anhängt: Die Liste führt ALLE `total`
    // Plätze, und geladen wird die Seite, auf der ein sichtbar gewordener Platz
    // liegt — vorwärts, rückwärts und nach einem Sprung. Nur so kann die
    // Zeitleiste rechts irgendwohin springen, statt zu filtern.
    //
    // Eine Seite Vorlauf in beide Richtungen, damit beim Scrollen keine
    // Platzhalter aufblitzen.
    LaunchedEffect(gridState, state.total, state.loadedPages.size) {
        snapshotFlow {
            val sichtbar = gridState.layoutInfo.visibleItemsInfo
            val ersteSeite = ((sichtbar.firstOrNull()?.index ?: 0) / CATALOG_PAGE_SIZE) + 1
            val letzteSeite = ((sichtbar.lastOrNull()?.index ?: 0) / CATALOG_PAGE_SIZE) + 1
            ersteSeite to letzteSeite
        }.collect { (von, bis) ->
            for (seite in (von - 1)..(bis + 1)) if (seite >= 1) onEnsurePage(seite)
        }
    }

    // ── Die Rollposition überlebt den Wechsel zur Detailseite ───────────────
    //
    // Marcos Befund: Nach dem Schliessen einer Detailseite stand die Liste ganz
    // oben. Die Detailseite ist ein eigener Navigationspunkt — beim Wechsel
    // verlässt diese Liste die Komposition, und der `LazyGridState` beginnt bei
    // der Rückkehr von vorn. Bei einer Liste, deren Länge erst nachträglich
    // eintrifft, hilft auch Compose' Wiederherstellung nicht: Sind im Moment
    // der Wiederherstellung noch keine Plätze da, gibt es keine Stelle, an die
    // gesprungen werden könnte.
    //
    // Gemeldet wird laufend in den Zustand (der lebt im ViewModel), und beim
    // Betreten wird EINMAL zurückgesprungen — sobald die Liste ihre Länge hat.
    //
    // ── Zwei Fehler, die das jahrelang verhinderten (Nachtrag 93) ───────────
    // Marco: „Der Fehler wurde im Katalog festgestellt." Er hatte recht, und
    // die Mechanik war gleich doppelt entwaffnet:
    //
    // 1. Der Merker war `rememberSaveable`. Der überlebt den Ausflug in die
    //    Detailseite — genau das, was er nicht soll. Beim ersten Betreten
    //    sprang der Katalog also zurück (nirgendwohin, die Position war ja
    //    null), setzte den Merker, und ab da war die Wiederherstellung für
    //    immer abgeschaltet. `remember` gilt je Komposition; nach der Rückkehr
    //    ist es eine neue.
    //
    // 2. Die Meldung lief SOFORT los. Bei der Rückkehr steht der frische
    //    `LazyGridState` auf null, `snapshotFlow` gibt diesen Wert unverzüglich
    //    heraus — und überschrieb damit die gemerkte Position, bevor jemand
    //    sie lesen konnte. Der Melder wartet jetzt, bis zurückgesprungen wurde.
    //
    // Die REIHENFOLGE ist also die eigentliche Regel: erst springen, dann
    // melden. Deshalb steht der Merker jetzt NACH dem Sprung auf true (ein
    // `scrollToItem` unterbricht) und der Melder hängt an ihm.
    // BEWUSST `remember`, NICHT `rememberSaveable` (Nachtrag 93, erneut 155):
    // Dieser Merker sagt "in DIESER Komposition wurde schon zurueckgesprungen".
    // Ueberlebt er den Ausflug in die Detailseite, gilt die Liste nach dem
    // allerersten Betreten fuer immer als wiederhergestellt — und die Rueckkehr
    // springt nie mehr zurueck. Genau das ist hier schon einmal passiert und
    // musste ein zweites Mal gemeldet werden.
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

    // ── Woran der Griff der Leiste haengt (Nachtrag 95, neu gefasst) ──────
    //
    // Marcos Befund damals: „im Katalog ist sie auf der korrekten Zeile, aber
    // die Scrollbar zeigt an, dass man sich zuoberst befindet." Der Griff
    // folgte NIE der Liste, sondern nur dem eigenen Ziehen.
    //
    // Hier stand daraufhin eine Rechnung „Jahr der obersten Kachel", weil die
    // Leiste am JAHR haengte. Sie haengt jetzt an der STELLE in der Liste —
    // wie ein Scrollbalken und wie in der Webapp. Damit braucht es die
    // Rechnung nicht mehr: gridState.firstVisibleItemIndex ist die Stelle,
    // und das Jahr dazu liefert die Verteilung (CatalogYearMath).

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
            stringResource(R.string.catalog_result_count, state.total),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp)
        )

        androidx.compose.material3.pulltorefresh.PullToRefreshBox(
            isRefreshing = state.isLoading && state.total > 0,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize()
        ) {
            // In eine lokale Variable gehoben, damit der Smart Cast greift:
            // `state` ist seit Nachtrag 115 ein DELEGIERTES Property (`by
            // katalog.state.collectAsStateWithLifecycle()`), vorher war es ein
            // Parameter. Bei einem Delegierten ruft jeder Zugriff erneut
            // getValue() auf — der Compiler kann also nicht garantieren, dass
            // `state.error` zwischen der Null-Prüfung und der Verwendung
            // derselbe Wert ist, und verweigert den Cast auf String.
            //
            // Bewusst KEIN `state.error ?: ""`: Das würde den leeren
            // Fehlertext klaglos anzeigen und die Ursache verstecken.
            val fehlertext = state.error
            when {
                state.isLoading && state.total == 0 -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    CircularProgressIndicator()
                }
                fehlertext != null && state.total == 0 -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("⚠️", fontSize = 40.sp)
                        Text(fehlertext, fontWeight = FontWeight.SemiBold)
                        Button(onClick = onRefresh, shape = Formen.knopf) { Text(stringResource(R.string.gallery_refresh)) }
                    }
                }
                state.total == 0 -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("🔍", fontSize = 40.sp)
                        Text(stringResource(R.string.catalog_no_results), fontWeight = FontWeight.SemiBold)
                    }
                }
                else -> Box(Modifier.fillMaxSize()) {
                    LazyVerticalGrid(
                        state = gridState,
                        columns = GridCells.Adaptive(160.dp),
                        contentPadding = PaddingValues(start = 12.dp, top = 12.dp, bottom = 12.dp, end = 30.dp),
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
                            if (set != null) CatalogSetCard(set, imageLoader, serverUrl, onSetClick)
                            else CatalogPlaceholderCard()
                        }
                    }
                    // Jahres-Leiste am rechten Rand — SCHNELL-SCROLL, kein
                    // Filter (Marcos Vorgabe): Ziehen rollt die Liste, das
                    // Etikett zeigt das Jahr an der Stelle, an der man gerade
                    // ist. Alles davor und danach bleibt erreichbar.
                    //
                    // Dieselbe Bedingung wie in der Webapp (_initYearRail):
                    // nur bei Sortierung nach Jahr. Steht die Liste nach Name
                    // oder Nummer, liegen die Jahre verstreut, und ein Jahr im
                    // Etikett waere ohne Aussage.
                    if (state.sort.startsWith("year_") && state.total > 0
                        && state.jahrVerteilung.isNotEmpty()) {
                        YearScrubber(
                            listenNummer = gridState.firstVisibleItemIndex,
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
                            onScrollTo = { nummer ->
                                // Die Zielseite gleich mitladen, damit an der
                                // Stelle nicht fuer einen Moment nur
                                // Platzhalter stehen.
                                onEnsurePage(nummer / CATALOG_PAGE_SIZE + 1)
                                onScrollTo(nummer)
                            },
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
 * Die Jahres-Leiste am rechten Rand — dieselbe wie in der Webapp.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * „Die App soll die gleiche Leiste wie die Webapp erhalten."
 *
 * Der Unterschied zur vorigen Fassung ist nicht das Aussehen, sondern woran
 * die Leiste haengt:
 *
 *   vorher   Position = Jahr, linear zwischen yearMin und yearMax verteilt.
 *            Der Griff folgte NUR dem Ziehen; wo die Liste stand, wusste er
 *            nicht. Losgelassen wurde auf das erste Set des Jahres gesprungen
 *            (GET /catalog/year-offset).
 *
 *   jetzt    Position = Stelle in der Liste, wie bei einem Scrollbalken. Der
 *            Griff folgt der Liste, und das Etikett zeigt das Jahr, das an
 *            dieser Stelle WIRKLICH liegt — gerechnet aus der Verteilung vom
 *            Server (CatalogYearMath.jahrAnPosition).
 *
 * Das lineare Modell war derselbe Fehler, den Marco in der Webapp gemeldet
 * hatte: „Es wurden die Sets von 1999 geladen, obwohl rechts 1965 steht."
 * Der Katalog stammt weit ueberwiegend aus den letzten Jahrzehnten; neun
 * Zehntel hinuntergezogen ist eben noch lange nicht bei den Sechzigern.
 *
 * Aufbau als Row (Etikett-Spur links, Gesten-Leiste rechts): Das Etikett darf
 * ueber die Kacheln ragen, ohne Beruehrungen abzufangen.
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
                        fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
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
 * `internal` statt `private`: Der Aufrufer steht seit dem Aufteilen in einer
 * ANDEREN Datei, und `private` gilt in Kotlin dateiweit (Nachtrag 101).
 * `internal` hält den Helfer weiterhin aus der öffentlichen Schnittstelle
 * heraus — sichtbar ist er nur innerhalb dieses Moduls.
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
            Modifier.padding(horizontal = 12.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(label, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (selected) Icon(Icons.Default.Check, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
/**
 * `internal` statt `private`: Der Aufrufer steht seit dem Aufteilen in einer
 * ANDEREN Datei, und `private` gilt in Kotlin dateiweit (Nachtrag 101).
 * `internal` hält den Helfer weiterhin aus der öffentlichen Schnittstelle
 * heraus — sichtbar ist er nur innerhalb dieses Moduls.
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
    onClick: (String) -> Unit
) {
    val ctx = LocalContext.current
    val isBrick = LocalIsBrickTheme.current
    AppKarte(
        modifier = Modifier.height(212.dp),
        onClick = { onClick(set.setNumber) }
    ) {
        Column {
            if (isBrick) BrickStudCap()
            Box(Modifier.fillMaxWidth().height(if (isBrick) 104.dp else 118.dp)) {
                // Über den Server auflösen statt roher CDN-Adresse. Der
                // Server prüft dabei, ob irgendein Nutzer dieses Katalog-Set
                // bereits heruntergeladen hat (eine nutzerunabhängige Datei,
                // benannt nach der Setnummer allein) — dann kommt das Bild
                // direkt von dort statt über den Proxy vom CDN. Schlägt auch
                // die Vorschau fehl, Rückfall auf die volle Auflösung, bevor
                // der Logo-Platzhalter greift.
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
                            fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp)
                        )
                    }
                }
            }
            Column(Modifier.padding(horizontal = 10.dp, vertical = 7.dp)) {
                Text(set.setNumber, style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                Text(set.name ?: "—", fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 16.sp)
                Spacer(Modifier.weight(1f))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("${set.year ?: "—"}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                        Text("${set.numParts}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}


/**
 * Platzhalter für einen Platz, dessen Seite noch nicht geladen ist.
 *
 * Er muss dieselbe HÖHE haben wie eine echte Kachel, sonst springt die Liste,
 * sobald die Seite eintrifft — und ein Sprung an eine Jahresgrenze landete
 * daneben.
 */
@Composable
private fun CatalogPlaceholderCard() {
    Card(
        shape = Formen.leiste,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)),
        modifier = Modifier.fillMaxWidth().height(200.dp)
    ) {}
}
