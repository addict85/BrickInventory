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
    imageLoader: ImageLoader,
    /** Klick auf ein Set — nur der Graph kennt den NavController. */
    onSetClick: (String) -> Unit,
) {
    // Zustand und Aktionen vom ViewModel statt über dreizehn Parameter —
    // dasselbe Muster wie in Galerie/Finanzen/Teile/Minifiguren (Nachtrag 96).
    // Die Namen darunter bleiben absichtlich dieselben, damit der Rumpf
    // unverändert ist.
    val state by vm.catalogState.collectAsStateWithLifecycle()
    val appState by vm.state.collectAsStateWithLifecycle()

    val serverUrl = appState.serverUrl

    val onQueryChange: (String) -> Unit = { q -> vm.setCatalogQuery(q) }
    val onThemeChange: (Int?) -> Unit = { t -> vm.setCatalogTheme(t) }
    val onYearChange: (Int?) -> Unit = { y -> vm.setCatalogYear(y) }
    val onSortChange: (String) -> Unit = { srt -> vm.setCatalogSort(srt) }
    /** Eine Seite laden, die gerade ins Bild kommt (vorwärts wie rückwärts). */
    val onEnsurePage: (Int) -> Unit = { seite -> vm.ensureCatalogPage(seite) }
    /** Zum ersten Set eines Jahres springen — ohne zu filtern. */
    val onJumpToYear: (Int) -> Unit = { jahr -> vm.jumpToCatalogYear(jahr) }
    /** Meldet, dass der Sprung ausgeführt wurde. */
    val onScrollConsumed: () -> Unit = { vm.catalogScrollConsumed() }
    /** Meldet die Rollposition, damit sie den Wechsel zur Detailseite überlebt. */
    val onScrollPos: (Int, Int) -> Unit = { index, offset -> vm.setCatalogScrollPos(index, offset) }
    val onRefresh: () -> Unit = { vm.loadCatalogMeta(); vm.loadCatalogSets() }

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

    // ── Welches Jahr steht gerade oben? (Nachtrag 95) ──────────────────────
    //
    // Marcos Befund: „im Katalog ist sie auf der korrekten Zeile, aber die
    // Scrollbar zeigt an, dass man sich zuoberst befindet."
    //
    // Die Liste stimmte also — das war der Daumen der Jahresleiste. Er folgte
    // NIE der Liste, sondern nur dem eigenen Ziehen: `previewYear` startet auf
    // `yearMax`, und `thumbOffset(yearMax)` ist genau null, also ganz oben.
    // Beim Rollen mit dem Finger blieb er ebenso stehen; aufgefallen ist es
    // erst nach der Detailseite, weil dort die Komposition neu beginnt und ein
    // vorher gezogenes Jahr damit verlorengeht.
    //
    // `derivedStateOf`, damit nicht jede Rollbewegung den ganzen Bildschirm neu
    // zusammensetzt — nur ein Wechsel des Jahres zählt.
    //
    // Nur bei Sortierung nach Jahr: Steht die Liste nach Name oder Nummer,
    // springt das Jahr der obersten Kachel wild umher, und ein Daumen, der
    // zappelt, ist schlechter als einer, der stillsteht.
    //
    // `rememberUpdatedState` ist hier nicht schmückend: `state` ist ein
    // PARAMETER, also ein Wert. Ein remember{} würde den Stand einfrieren, den
    // es beim Anlegen gesehen hat, und `loadedPages` füllt sich erst danach —
    // der Daumen bliebe stumm, sobald eine Seite nachlädt.
    val aktuellerStand by rememberUpdatedState(state)
    val sichtbaresJahr by remember {
        derivedStateOf {
            val st = aktuellerStand
            if (!st.sort.startsWith("year_")) null
            else {
                val i = gridState.firstVisibleItemIndex
                st.loadedPages[i / CATALOG_PAGE_SIZE + 1]
                    ?.getOrNull(i % CATALOG_PAGE_SIZE)?.year
            }
        }
    }

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
            // vm.catalogState.collectAsStateWithLifecycle()`), vorher war es ein
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
                    // Filter (Marcos Vorgabe): Ziehen zeigt das Jahr als
                    // kleines Etikett, Loslassen springt an dessen erste Zeile.
                    // Alles davor und danach bleibt erreichbar.
                    if ((state.yearMin ?: 0) > 0 && (state.yearMax ?: 0) > (state.yearMin ?: 0)) {
                        YearScrubber(
                            listenJahr = sichtbaresJahr,
                            yearMin = state.yearMin!!,
                            yearMax = state.yearMax!!,
                            onYearSelected = onJumpToYear,
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
 * Vertikaler Jahres-Scrubber wie der Schnell-Scroll in der Foto-Galerie:
 * Am rechten Rand ziehen — eine Bubble zeigt live das Jahr (und die
 * Set-Zahl); beim Loslassen wird auf dieses Jahr gefiltert. Oben = neuestes
 * Jahr, unten = ältestes. Tippen auf die Leiste springt direkt.
 *
 * Aufbau als Row (Bubble-Spur links, Gesten-Leiste rechts): die Bubble
 * braucht mehr Breite als die 28dp-Leiste — läge sie in derselben Box,
 * würden die Constraints den Text umbrechen. Die Bubble-Spur hat keinen
 * pointerInput und lässt Touches zum Grid durch.
 */
@Composable
private fun YearScrubber(
    /** Jahr der obersten sichtbaren Kachel — `null`, wenn es keins gibt. */
    listenJahr: Int?,
    yearMin: Int,
    yearMax: Int,
    onYearSelected: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    // Kein `selectedYear` mehr: Die Leiste filtert nicht, sie springt. Ein
    // dauerhaft markiertes Jahr gäbe es also gar nicht — der Daumen zeigt
    // während des Ziehens, wohin es geht, und danach steht die Liste dort.
    var dragging by remember { mutableStateOf(false) }
    var previewYear by remember(yearMax) { mutableStateOf(yearMax) }
    var heightPx by remember { mutableStateOf(1) }
    val thumbHeightPx = with(LocalDensity.current) { 36.dp.roundToPx() }

    // Mathematik extrahiert nach CatalogYearMath (unit-getestet)
    fun yearAt(y: Float): Int =
        CatalogYearMath.yearAt(y, heightPx, thumbHeightPx, yearMin, yearMax)
    fun offsetOf(year: Int): Int =
        CatalogYearMath.thumbOffset(year, heightPx, thumbHeightPx, yearMin, yearMax)

    // Beim Ziehen zeigt der Daumen, WOHIN es geht; sonst, WO man ist. Vorher
    // gab es nur den ersten Fall — und ohne Ziehen stand er auf `yearMax`, also
    // dauerhaft ganz oben, ganz gleich wie weit die Liste gerollt war.
    val thumbYear = if (dragging) previewYear else (listenJahr ?: previewYear)
    val thumbOffsetY = offsetOf(thumbYear)

    Row(modifier) {
        // Bubble-Spur — nur sichtbar beim Ziehen, fängt keine Touches
        Box(Modifier.fillMaxHeight()) {
            if (dragging) {
                // Kleines Etikett statt grosser Blase (Marcos Wunsch, wie in
                // der Foto-App): heller Grund, eine Zeile, direkt an der
                // Leiste. Die Zahl der Sets steht nicht mehr dabei — sie war
                // eine Filter-Auskunft („so viele bekommst du"), und gefiltert
                // wird hier nicht mehr.
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
                        "$previewYear",
                        fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp)
                    )
                }
            }
        }

        // Gesten-Leiste (28dp) mit Schiene + Daumen
        Box(
            Modifier
                .width(28.dp)
                .fillMaxHeight()
                .onSizeChanged { heightPx = it.height }
                .pointerInput(yearMin, yearMax) {
                    detectVerticalDragGestures(
                        onDragStart = { offset ->
                            dragging = true
                            previewYear = yearAt(offset.y)
                        },
                        onVerticalDrag = { change, _ ->
                            change.consume()
                            previewYear = yearAt(change.position.y)
                        },
                        onDragEnd = {
                            dragging = false
                            onYearSelected(previewYear)
                        },
                        onDragCancel = { dragging = false }
                    )
                }
                .pointerInput(yearMin, yearMax) {
                    detectTapGestures { offset ->
                        val y = yearAt(offset.y)
                        previewYear = y
                        onYearSelected(y)
                    }
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

            // Daumen — immer sichtbar, folgt dem gewählten Jahr
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
                        // Stein-Design: Daumen als Noppe (heller Stud-Punkt)
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
