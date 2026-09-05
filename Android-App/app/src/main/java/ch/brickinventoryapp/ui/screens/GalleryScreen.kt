package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.*  // Feature-Extensions (loadSets, setScope, …)
import ch.brickinventoryapp.data.model.SetItem
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.BrickStudCap
import ch.brickinventoryapp.util.fmtInt
import ch.brickinventoryapp.util.rememberTileImageWithFallback
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil.compose.AsyncImage
import coil.ImageLoader
import coil.request.ImageRequest
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.debounce
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.util.NumericInput

@OptIn(ExperimentalMaterial3Api::class, FlowPreview::class)
@Composable
fun GalleryScreen(
    vm: MainViewModel,
    imageLoader: ImageLoader,
    /** Barcode-Scanner öffnen — nur der Graph kennt den NavController. */
    onScanBarcode: () -> Unit,
    /** Klick auf ein Set, ebenso. */
    onSetClick: (String) -> Unit,
    /** Scroll-Zustand von aussen, siehe Nachtrag 92. */
    gridState: LazyGridState = rememberLazyGridState(),
) {
    // Zustand und Aktionen vom ViewModel statt über sechsundzwanzig Parameter —
    // die Begründung steht bei PartsScreen (Nachtrag 96). Die Namen bleiben
    // absichtlich dieselben, damit der Rumpf darunter unverändert bleibt.
    val state by vm.state.collectAsStateWithLifecycle()
    // Eigener Fluss fuer die Galerie: Blaettern, Suchen und Nachladen aendern
    // nur noch DIESEN Zustand — die uebrigen Bildschirme, die `vm.state`
    // sammeln, werden dadurch nicht mehr mit rekomponiert (siehe GalleryUiState).
    val galerie by vm.galleryState.collectAsStateWithLifecycle()
    val barcodeState by vm.barcodeState.collectAsStateWithLifecycle()

    val sets = galerie.sets
    val query = galerie.galleryQuery
    val theme = galerie.galleryTheme
    val sort = galerie.gallerySort
    val themes = galerie.galleryThemes
    val total = galerie.galleryTotal
    val loadingMore = galerie.galleryLoadingMore
    val stats = galerie.stats
    val isLoading = galerie.galleryLoading
    val serverUrl = state.serverUrl
    val defaultCondition = state.userDefaultCondition ?: "N"
    val currency = state.currency
    val householdMembers = state.householdMembers
    val scopeMode = state.scopeModes[ch.brickinventoryapp.data.ScopeFilter.View.GALLERY.key]
        ?: ch.brickinventoryapp.data.ScopeFilter.ALL

    val onQueryChange: (String) -> Unit = vm::setGalleryQuery
    val onThemeChange: (String) -> Unit = vm::setGalleryTheme
    val onSortChange: (String) -> Unit = vm::setGallerySort
    val onLoadMore: () -> Unit = vm::loadMoreSets
    val onDeleteSet: (String) -> Unit = vm::deleteSet
    val onScopeChange: (String) -> Unit = { vm.setScope(ch.brickinventoryapp.data.ScopeFilter.View.GALLERY, it) }
    val onRefresh: () -> Unit = { vm.loadSets(); vm.loadStats() }
    val onAddSet: (String, Int, Double?, String?, Int?) -> Unit =
        { sn, qty, price, cond, owner -> vm.addSet(sn, qty, price, cond, owner) }

    var showAddDialog by rememberSaveable { mutableStateOf(false) }

    // ── Erfolgloser Scan öffnet die manuelle Erfassung (Nachtrag 113) ─────────
    //
    // Marcos Vorgabe. Die drei erfolglosen Wege (EAN nicht auflösbar, EAN ohne
    // Setnummer, Texterkennung ohne Treffer) melden sich über ein Feld im
    // Zustand; hier wird es abgeholt und quittiert. Ohne Quittierung ginge der
    // Dialog beim nächsten Zusammensetzen erneut auf.
    LaunchedEffect(barcodeState.manuelleErfassungAnfordern) {
        if (barcodeState.manuelleErfassungAnfordern) {
            showAddDialog = true
            vm.manuelleErfassungQuittieren()
        }
    }
    // Das Eingabefeld hält seinen Text selbst (Tippen bleibt flüssig); die
    // Entprellung und der Abruf liegen im ViewModel, weil dort auch die
    // Filter-Generation hängt. Wechselt der Wert von aussen (Anmeldung,
    // Zurücksetzen), zieht das Feld nach.
    var searchInput by remember(query) { mutableStateOf(query) }
    var showSortMenu by rememberSaveable { mutableStateOf(false) }

    // KEIN lokales Filtern und keine Themenliste aus `sets` mehr: Beides war
    // eine zweite Fassung der Suche neben der des Servers — ohne Jahr im
    // Suchtext, ohne Sortierung, und die Themen kamen aus der geladenen Seite
    // statt aus dem Bestand. Der Schirm zeigt jetzt genau das, was der Server
    // geliefert hat.

    // Endlos-Scroll: nachladen, sobald die letzten Kacheln in Sicht kommen.
    LaunchedEffect(gridState, sets.size, total) {
        snapshotFlow {
            val letzte = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            letzte >= sets.size - 6 && sets.isNotEmpty()
        }.collect { nah -> if (nah) onLoadMore() }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {

            // Stats bar — directly under TopBar, no gap
            if (stats != null) {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 2.dp
                ) {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        // fmtInt() statt "%,d" mit anschliessendem Ersetzen des
                        // Kommas: Das war eine vierte, handgeschriebene
                        // Zahlenfassung neben den drei Beträgen — und sie
                        // erzwang den Apostroph auch dann, wenn die App auf
                        // Englisch läuft. Die Webapp formatiert dieselben
                        // Kennzahlen mit toLocaleString(locale()).
                        item { GalleryStatChip(fmtInt(stats.totalSets), stringResource(R.string.gallery_stat_sets)) }
                        item { GalleryStatChip(fmtInt(stats.totalQuantity), stringResource(R.string.gallery_stat_units)) }
                        item { GalleryStatChip(fmtInt(stats.totalParts), stringResource(R.string.gallery_stat_parts)) }
                        if (stats.totalMinifigs > 0)
                            item { GalleryStatChip(fmtInt(stats.totalMinifigs), stringResource(R.string.gallery_stat_minifigs)) }
                    }
                }
            }

            ScopeFilterZeile(householdMembers, scopeMode, onScopeChange)

            // Suchfeld — gemeinsamer Baustein (Nachtrag 132).
            Suchfeld(
                wert = searchInput,
                onWert = { searchInput = it; onQueryChange(it) },
                platzhalter = stringResource(R.string.gallery_search_placeholder),
            )

            // Sortierung und Themen — beides wird auf dem SERVER angewandt.
            // Die Zeile erscheint auch ohne Themen, weil die Sortierung darin
            // steht; vorher gab es am Telefon gar keine Sortierung, während die
            // Webapp neun Möglichkeiten bot.
            LazyRow(
                contentPadding = PaddingValues(horizontal = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(bottom = 6.dp)
            ) {
                    item {
                        Box {
                            FilterChip(
                                selected = sort != ch.brickinventoryapp.data.repository.GALLERY_DEFAULT_SORT,
                                onClick = { showSortMenu = true },
                                label = { Text(gallerySortLabel(sort), fontSize = 12.sp) },
                                leadingIcon = { Icon(Icons.AutoMirrored.Filled.Sort, null, Modifier.size(16.dp)) },
                                shape = Formen.chip
                            )
                            DropdownMenu(showSortMenu, { showSortMenu = false }) {
                                // Dieselben Werte wie SET_SORTS auf dem Server
                                // (utils/handlers.ts) und dieselbe Auswahl wie in
                                // der Webapp — ein unbekannter Wert fiele dort auf
                                // die Vorgabe zurück, wäre hier also eine stille
                                // Wirkungslosigkeit.
                                listOf("added_desc", "added_asc", "name_asc", "num_asc",
                                       "year_desc", "price_desc", "price_asc",
                                       "qty_desc", "qty_asc").forEach { w ->
                                    DropdownMenuItem(
                                        text = { Text(gallerySortLabel(w)) },
                                        onClick = { showSortMenu = false; onSortChange(w) },
                                        trailingIcon = { if (sort == w) Icon(Icons.Default.Check, null, Modifier.size(16.dp)) }
                                    )
                                }
                            }
                        }
                    }
                    item {
                        FilterChip(
                            selected = theme.isEmpty(),
                            onClick = { onThemeChange("") },
                            label = { Text(stringResource(R.string.gallery_all), fontSize = 12.sp) },
                            shape = Formen.chip
                        )
                    }
                    items(themes, key = { it }) { t ->
                        FilterChip(
                            selected = theme == t,
                            onClick = { onThemeChange(if (theme == t) "" else t) },
                            label = { Text(t, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            modifier = Modifier.widthIn(max = 140.dp),
                            shape = Formen.chip
                        )
                    }
            }

            PullToRefreshBox(isRefreshing = isLoading, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
                when {
                    isLoading && sets.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                        CircularProgressIndicator()
                    }
                    sets.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (searchInput.isBlank() && theme.isEmpty()) {
                                Image(painterResource(R.drawable.ic_logo), null, Modifier.size(64.dp))
                                Text(stringResource(R.string.gallery_no_sets), fontWeight = FontWeight.SemiBold)
                                Text(stringResource(R.string.gallery_pull_to_refresh),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Button(onClick = onRefresh, shape = Formen.knopf) { Text(stringResource(R.string.gallery_refresh)) }
                            } else {
                                Text("🔍", fontSize = 40.sp)
                                Text(stringResource(R.string.gallery_no_results, searchInput), fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                    else -> LazyVerticalGrid(
                        columns = GridCells.Adaptive(160.dp),
                        state = gridState,
                        contentPadding = PaddingValues(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(sets, key = { it.setNumber }) { set ->
                            SetCard(set, serverUrl, imageLoader, onSetClick, onDeleteSet)
                        }
                        if (loadingMore) {
                            // ── Eigener Schlüssel für den Lade-Eintrag (Nachtrag 108) ──
                            //
                            // Die Kacheln darüber sind verschlüsselt
                            // (key = { it.setNumber }). Ein Eintrag OHNE Schlüssel
                            // bekommt in einer solchen Liste einen Ersatz, der aus
                            // seinem Index gebildet wird — und der wechselt, sobald
                            // die Liste wächst. Für das Raster verschwindet damit
                            // ein Eintrag und ein anderer erscheint, statt dass
                            // derselbe stehen bleibt.
                            //
                            // Ein fester Schlüssel macht ihn zu dem, was er ist:
                            // EIN Eintrag, der mal da ist und mal nicht.
                            item(key = "gallery-loading-more", span = { GridItemSpan(maxLineSpan) }) {
                                Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) {
                                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                                }
                            }
                        }
                    }
                }
            }
        }

        // FAB overlay — bottom end of Box
        Column(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 16.dp, bottom = 16.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            SmallFloatingActionButton(
                onClick = onScanBarcode,
                containerColor = MaterialTheme.colorScheme.secondaryContainer,
                contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                shape = Formen.leiste
            ) { Icon(Icons.Default.QrCodeScanner, stringResource(R.string.gallery_scan_barcode)) }
            FloatingActionButton(
                onClick = { showAddDialog = true },
                containerColor = if (LocalIsBrickTheme.current) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primary,
                contentColor = if (LocalIsBrickTheme.current) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onPrimary,
                shape = Formen.fab
            ) { Icon(Icons.Default.Add, stringResource(R.string.gallery_add_set)) }
        }
    }

    if (showAddDialog) {
        AddSetDialog(
            onDismiss = { showAddDialog = false },
            onAdd = { sn, qty, price, cond, owner -> showAddDialog = false; onAddSet(sn, qty, price, cond, owner) },
            householdMembers = householdMembers,
            defaultCondition = defaultCondition
        )
    }
}

@Composable
fun GalleryStatChip(value: String, label: String) {
    Surface(
        shape = Formen.chip,
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
        tonalElevation = 0.dp
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)
        ) {
            Text(value, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(label, style = MaterialTheme.typography.labelSmall, fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetCard(
    set: SetItem,
    serverUrl: String,
    imageLoader: ImageLoader,
    onClick: (String) -> Unit,
    onDelete: (String) -> Unit
) {
    var showMenu by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    val ctx = LocalContext.current
    // Über den Server auflösen statt roher CDN-Adresse: liefert ein
    // Vorschaubild (kleiner, schneller) und lässt den Server die
    // Netzwerkarbeit gegen das CDN machen — inklusive seiner bereits
    // gehärteten Logik (Referer-Rückfall, Entpacken, Negativ-Cache). Siehe
    // util/ImageUrls.kt.
    // Vorschaubild mit Rückfall auf die volle Auflösung, wenn die
    // "_thumb.jpg"-Datei (noch) nicht existiert.
    //
    // Frühere Fassung: ein Wiederholversuch derselben Adresse nach einer
    // Sekunde. Das half bei einem echten, einmaligen Netzwerk-Aussetzer,
    // aber NICHT bei der eigentlichen Ursache — nach einem CSV-Import legt
    // der Server Original-Bilder sofort ab, erzeugt die "_thumb"-Varianten
    // aber nachträglich in einer eigenen, langsamen Warteschlange
    // (server.ts, "Generate missing thumbnails"). Fragt die Kachel in dieser
    // Zeit die Vorschau an, bekommt sie zuverlässig 404 — auch beim zweiten
    // Versuch derselben (weiterhin fehlenden) Datei. Die Webapp fällt in
    // genau diesem Fall auf die volle Auflösung zurück (public/js/11-actions.js,
    // data-orig) — das bildet rememberTileImageWithFallback() jetzt nach.
    val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)

    // Einmaliger, verzögerter Wiederholversuch nach einem Ladefehler.
    //
    // Beobachtet (Marcos Bericht zu neu erfassten Sets): Die Kachel bleibt
    // dauerhaft leer, obwohl die Webapp dasselbe Bild anzeigt. Beim ERSTEN
    // Anzeigen direkt nach dem Erfassen ist die Datei auf dem Server oft noch
    // nicht fertig — der Server lädt sie mit Frist herunter und erzeugt die
    // Vorschau danach im Hintergrund. Coil versucht eine fehlgeschlagene
    // Anfrage NIE von sich aus erneut, und das Ergebnis bleibt an der Kachel
    // hängen, solange sie im Speicher ist. Deshalb blieb es auch später leer,
    // während ein frisch geladener Browser das Bild längst bekam.
    //
    // retryNonce ist an setNumber UND imageUrl gebunden: Wird die Kachel
    // wiederverwendet (LazyGrid recycelt) oder ändert sich die Adresse, beginnt
    // die Zählung neu. setParameter("retry", …) macht die zweite Anfrage für
    // Coil unterscheidbar — ohne das würde sie als dieselbe (gescheiterte)
    // Anfrage behandelt. Genau EIN Versuch, damit ein dauerhaft fehlendes Bild
    // nicht in eine Endlosschleife läuft.
    var retryNonce by remember(set.setNumber, imageUrl) { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    val isBrick = LocalIsBrickTheme.current

    AppKarte(
        // Höher als vorher (232.dp) — Nachtrag 52, Marcos Wunsch: Die
        // Etiketten sollen das Vorschaubild nicht mehr überdecken. Die zusätzliche
        // Höhe geht vollständig an den Bildbereich; die Textzeilen darunter
        // bleiben unverändert.
        modifier = Modifier.height(272.dp),
        onClick = { onClick(set.setNumber) }
    ) {
        Column {
            if (isBrick) BrickStudCap()
            Box(Modifier.fillMaxWidth().height(if (isBrick) 154.dp else 170.dp)) {
                if (imageUrl != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(ctx).data(imageUrl)
                            .setParameter("retry", retryNonce)
                            .crossfade(true).build(),
                        imageLoader = imageLoader,
                        contentDescription = set.name,
                        onState = { st ->
                            if (st is coil.compose.AsyncImagePainter.State.Error && retryNonce == 0) {
                                // Verzögert, nicht im selben Moment: Direkt nach
                                // dem Erfassen erzeugt der Server die Vorschau
                                // erst noch.
                                scope.launch {
                                    kotlinx.coroutines.delay(1000)
                                    retryNonce = 1
                                }
                            } else if (st is coil.compose.AsyncImagePainter.State.Error) {
                                // Auch der zweite Versuch scheiterte — jetzt auf
                                // die volle Auflösung ausweichen (fehlende
                                // _thumb-Datei ist der häufigste Grund).
                                onImageError()
                            }
                        },
                        // Unten Platz lassen: Genau dort sitzen Zustands- und
                        // Besitzer-Etiketten (BottomStart). Ohne diesen Streifen
                        // liegen sie ÜBER dem Bild — bei einem Foto, das die
                        // Fläche ausfüllt, verdecken sie es (Nachtrag 52).
                        // ContentScale.Fit skaliert in den verbleibenden Raum,
                        // das Bild wird also nicht beschnitten, sondern rückt
                        // nach oben.
                        modifier = Modifier.fillMaxSize().padding(bottom = 44.dp)
                            .then(if (isBrick) Modifier else Modifier.clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))),
                        contentScale = ContentScale.Fit
                    )
                } else {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Image(painterResource(R.drawable.ic_logo), null, Modifier.size(56.dp))
                    }
                }
                if (set.quantity > 1) {
                    Surface(
                        color = MaterialTheme.colorScheme.primary,
                        shape = Formen.etikett,
                        modifier = Modifier.align(Alignment.TopEnd).padding(6.dp)
                    ) {
                        Text(stringResource(R.string.gallery_quantity_badge, set.quantity), Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    }
                }
                // Column statt Box (Nachtrag 33): Eine Box STAPELT ihre Kinder —
                // die Besitzer-Etiketten lagen über den Zustandsplaketten, auf
                // Marcos Screenshot lugte das verdeckte „N/G" zwischen den
                // Namen hervor. Untereinander bleibt beides lesbar.
                Column(Modifier.align(Alignment.BottomStart).padding(6.dp),
                       verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    ConditionBadges(set.conditions, set.condition)
                    // Wem gehört dieses Exemplar? Ohne die Angabe verschiebt
                    // man im Haushalt das falsche.
                    OwnerBadges(set.owners)
                }
                Box(Modifier.align(Alignment.TopStart).padding(2.dp)) {
                    IconButton(onClick = { showMenu = true }, Modifier.size(28.dp)) {
                        Icon(Icons.Default.MoreVert, stringResource(R.string.cd_set_menu), Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
                    }
                    DropdownMenu(showMenu, { showMenu = false }) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error) },
                            onClick = { showMenu = false; deleting = true },
                            leadingIcon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) }
                        )
                    }
                }
            }
            Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(set.setNumber, style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(set.name ?: set.setNumber, fontWeight = FontWeight.SemiBold,
                    maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 13.sp,
                    lineHeight = 16.sp)
                if (set.theme != null) Text(set.theme,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.8f), maxLines = 1)
                if (set.pieces != null) Text(fmtInt(set.pieces) + stringResource(R.string.gallery_pieces_suffix),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }

    if (deleting) {
        AlertDialog(
            onDismissRequest = { deleting = false },
            icon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
            title = { Text(stringResource(R.string.gallery_delete_title)) },
            text = { Text(stringResource(R.string.gallery_delete_text, set.name ?: set.setNumber)) },
            confirmButton = {
                TextButton(onClick = { deleting = false; onDelete(set.setNumber) }) {
                    Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { deleting = false }) { Text(stringResource(R.string.common_cancel)) } }
        )
    }
}

@Composable
fun AddSetDialog(
    onDismiss: () -> Unit,
    onAdd: (String, Int, Double?, String?, Int?) -> Unit,
    defaultCondition: String = "N",
    /** Konten des Haushalts — ohne Unterkonten bleibt die Auswahl verborgen. */
    householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember> = emptyList()
) {
    var setNumber by rememberSaveable { mutableStateOf("") }
    var quantity  by rememberSaveable { mutableStateOf("1") }

    // ── Der Cursor steht sofort im Set-Feld (Nachtrag 113) ────────────────────
    //
    // Marcos Vorgabe: „Wenn der Dialog für die manuelle Erfassung erscheint,
    // soll der Cursor bereits im Set-Feld sein — immer, wenn das Formular
    // angezeigt wird."
    //
    // `LaunchedEffect(Unit)` läuft genau einmal je Anzeige: Der Dialog wird bei
    // jedem Öffnen neu zusammengesetzt, bei jedem Schliessen verworfen. Die
    // kurze Pause davor ist nötig, weil das Feld beim ersten Durchlauf noch
    // nicht angeordnet ist — ein `requestFocus()` liefe dann ins Leere.
    val setFeldFokus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(120)
        try { setFeldFokus.requestFocus() } catch (_: Exception) { /* Dialog schon zu */ }
    }
    var purchasePrice by rememberSaveable { mutableStateOf("") }
    var condition by rememberSaveable { mutableStateOf(defaultCondition) }
    // Vorbelegt mit dem eigenen Konto: Wer nichts wählt, erfasst für sich —
    // dasselbe Verhalten wie vor der Haushaltssicht.
    var owner by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }
    val keyboard  = LocalSoftwareKeyboardController.current

    fun submit() {
        if (setNumber.isNotBlank()) {
            onAdd(setNumber, quantity.toIntOrNull() ?: 1,
                  purchasePrice.replace(',', '.').toDoubleOrNull(), condition,
                  // Ohne Haushalt gar nichts mitschicken — der Server bleibt
                  // dann beim eigenen Konto.
                  if (householdMembers.size > 1) owner else null)
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Add, null, tint = MaterialTheme.colorScheme.primary) },
        title = { Text(stringResource(R.string.gallery_add_set_title), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OwnerPicker(householdMembers, owner, { owner = it })
                OutlinedTextField(
                    value = setNumber,
                    onValueChange = { setNumber = NumericInput.setNumber(it) },
                    label = { Text(stringResource(R.string.gallery_set_number)) },
                    placeholder = { Text(stringResource(R.string.gallery_set_number_placeholder)) },
                    modifier = Modifier.fillMaxWidth().focusRequester(setFeldFokus), singleLine = true,
                    shape = Formen.knopf,
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                OutlinedTextField(
                    value = quantity,
                    onValueChange = { quantity = NumericInput.quantity(it) },
                    label = { Text(stringResource(R.string.common_quantity)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf,
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                OutlinedTextField(
                    value = purchasePrice,
                    onValueChange = { purchasePrice = NumericInput.price(it) },
                    label = { Text(stringResource(R.string.gallery_purchase_price)) },
                    placeholder = { Text(stringResource(R.string.common_unit_price_placeholder)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf,
                    keyboardOptions = NumericInput.preisTastatur(),
                    keyboardActions = KeyboardActions(onDone = { keyboard?.hide(); submit() })
                )
                Zustandszeile(zustand = condition, onZustand = { condition = it })
            }
        },
        confirmButton = {
            Button(onClick = { submit() },
                enabled = setNumber.isNotBlank(), shape = Formen.knopf) { Text(stringResource(R.string.gallery_add)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } },
        shape = Formen.chip
    )
}



/**
 * Beschriftung eines Sortierwerts. Die Werte selbst sind die des Servers
 * (SET_SORTS in utils/handlers.ts) — hier wird nur übersetzt.
 */
@Composable
private fun gallerySortLabel(wert: String): String = when (wert) {
    "added_asc"  -> stringResource(R.string.gallery_sort_added_asc)
    "name_asc"   -> stringResource(R.string.gallery_sort_name)
    "num_asc"    -> stringResource(R.string.gallery_sort_number)
    "year_desc"  -> stringResource(R.string.gallery_sort_year_desc)
    "price_desc" -> stringResource(R.string.gallery_sort_price_desc)
    "price_asc"  -> stringResource(R.string.gallery_sort_price_asc)
    "qty_desc"   -> stringResource(R.string.gallery_sort_qty_desc)
    "qty_asc"    -> stringResource(R.string.gallery_sort_qty_asc)
    else         -> stringResource(R.string.gallery_sort_added_desc)
}
