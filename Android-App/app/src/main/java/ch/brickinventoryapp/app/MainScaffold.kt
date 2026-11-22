package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.components.focusFrame
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import kotlin.math.roundToInt
import kotlin.reflect.KClass
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.foundation.background
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.rememberTextMeasurer
import ch.brickinventoryapp.ui.theme.TabColors
import ch.brickinventoryapp.ui.theme.tabColors
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.account.ui.KontoZiel
import ch.brickinventoryapp.collection.ui.SammlungZiel
import ch.brickinventoryapp.parts.ui.TeileZiel
import ch.brickinventoryapp.ui.NavigationMode
import ch.brickinventoryapp.ui.Reiterziel
import ch.brickinventoryapp.ui.navigationMode
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.ui.vergissReiter
import ch.brickinventoryapp.management.ui.ManagementTarget
import ch.brickinventoryapp.app.nav.Reiter
import ch.brickinventoryapp.app.nav.TargetEnvironment
import ch.brickinventoryapp.ui.components.ExitBar
import ch.brickinventoryapp.ui.components.LocalOpenChanges
import ch.brickinventoryapp.ui.components.LocalOfflineHints
import ch.brickinventoryapp.ui.components.LocalSnackbarSpace
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ViewToggle
import ch.brickinventoryapp.ui.components.UpdatePoint
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.LocalAkzentflaechen
import ch.brickinventoryapp.app.ui.components.CsvImportBanner
import ch.brickinventoryapp.app.csv.CsvImportUiState
import ch.brickinventoryapp.app.nav.AppTarget

/**
 * Common scaffold of all signed-in screens: top bar with title and
 * tab icon, bottom navigation (side bar on wide windows), snackbar
 * and the CSV import bar. It gets everything via its parameters and accesses
 * nothing from the surrounding composable.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScaffold(
    title: String,
    navController: androidx.navigation.NavController,
    bottomNavItems: List<Reiter>,
    snackbarHostState: SnackbarHostState,
    csvImportState: kotlinx.coroutines.flow.StateFlow<CsvImportUiState>,
    /**
     * Cancel the running CSV import — the button in the progress bar. As a callback,
     * because this scaffold only gets state and callbacks, no ViewModel.
     */
    onCsvAbbrechen: () -> Unit,
    /**
     * Is a newer version available? The check runs app-wide at start; the
     * scaffold shows the finding as a dot on the destination “More”, where it stands at the
     * settings once more. Loading never happens by itself.
     */
    updateVerfuegbar: Boolean = false,
    /**
     * A tab was tapped at the bottom — discard its remembered scroll position. “I
     * come back” keeps the position, “I go to this tab” starts at the top
     * (where the manually added entries are); this can only be distinguished
     * here. Without a default value, so that an integration that forgets it does not
     * compile.
     */
    onTabAngetippt: (Any) -> Unit,
    /** Changes saved offline that still have to go to the server; 0 hides the bar. */
    offeneAenderungen: Int = 0,
    content: @Composable () -> Unit
) {
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDest = navBackStackEntry?.destination
    val accent = LocalAkzentflaechen.current
    // The app bar yields when scrolling down and comes back when scrolling back:
    // on the phone title and switcher otherwise stood permanently above the content.
    // A new destination starts with a visible bar.
    val collapse = TopAppBarDefaults.enterAlwaysScrollBehavior()
    LaunchedEffect(currentDest?.id) { collapse.state.heightOffset = 0f }

    fun isSelected(screen: Any) =
        currentDest?.hierarchy?.any { d -> d.isOneOf(targetsOf(screen)) } == true

    // Subpages of “More” with a bottom bar carry the back arrow like the other
    // More subpages. It goes the same way as the back gesture: if both led to
    // different places, one would not know before tapping where one lands. Only without
    // a previous entry (entry from outside) does it lead to “More”.
    val moreSubpage = currentDest != null && currentDest.isOneOf(MORE) && !currentDest.hasRoute<AppTarget.Mehr>()
    fun backFromMore() {
        if (navController.previousBackStackEntry != null && navController.popBackStack()) return
        if (!navController.popBackStack(AppTarget.Mehr, inclusive = false)) navController.toTab(AppTarget.Mehr)
    }

    // Bottom bar and side bar share this path so that both treat the
    // scroll position the same.
    fun tabChoose(screen: Any) {
        onTabAngetippt(screen)
        if (navController.currentBackStackEntry?.destination?.hasRoute<ManagementTarget.Monitoring>() == true) {
            navController.popBackStack()
        }
        navController.toTab(screen)
    }

    // The icon of a destination, on “More” with the dot for a new version.
    @Composable
    fun Symbol(screen: Any, icon: @Composable () -> Unit) {
        if (screen == AppTarget.Mehr && updateVerfuegbar) BadgedBox(badge = { UpdatePoint() }) { icon() } else icon()
    }

    // The window width decides, not the device: a tablet in split
    // screen is narrow and gets the bar at the bottom.
    // The snackbar lies above the content; its height lifts the add button above it.
    var snackbarHeight by remember { mutableIntStateOf(0) }
    val offlineHints = remember { mutableIntStateOf(0) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val art = navigationMode(maxWidth.value)
        // On wide windows the side bar stands at full height on the left, app bar
        // and content to the right of it — the same destinations as below, “More” included.
        Row(Modifier.fillMaxSize()) {
        if (art == NavigationMode.SIDEBAR) {
            TabSidebar(bottomNavItems, ::isSelected, ::tabChoose) { screen, icon -> Symbol(screen, icon) }
        }
        Scaffold(
            modifier = Modifier.weight(1f).nestedScroll(collapse.nestedScrollConnection),
            topBar = {
              Column {
                TopAppBar(
                    // Plain text like every Material title: an icon in front read like a menu button
                    // on “More”. Screen readers jump to the heading.
                    title = { Text(title, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) },
                    navigationIcon = {
                        if (moreSubpage) MitTooltip(stringResource(R.string.common_back)) {
                            IconButton(onClick = { backFromMore() }) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.common_back))
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = accent.leiste,
                        titleContentColor = accent.onBar,
                        navigationIconContentColor = accent.onBar,
                        actionIconContentColor = accent.onBar,
                        scrolledContainerColor = accent.leiste,
                    ),
                    scrollBehavior = collapse,
                )
                if (art == NavigationMode.LEISTE_UNTEN && currentDest?.isOneOf(SAMMLUNG) == true) {
                    CollectionToggle(collectionTarget(currentDest), onWahl = { ziel ->
                        onTabAngetippt(ziel)
                        navController.toTab(ziel)
                    }, modifier = Modifier.withBarCollapse { collapse.state.collapsedFraction })
                }
              }
            },
            bottomBar = {
                if (art == NavigationMode.LEISTE_UNTEN) {
                    TabBar(bottomNavItems, ::isSelected, ::tabChoose) { screen, icon -> Symbol(screen, icon) }
                }
            },
            snackbarHost = { SnackbarHost(snackbarHostState, Modifier.onSizeChanged { snackbarHeight = it.height }) },
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
        ) { padding ->
            // Global CSV import bar: appears on all tabs (as in the
            // web app) as soon as an import runs — no matter where it was started.
            val csvImport by csvImportState.collectAsStateWithLifecycle()
            Row(Modifier.fillMaxSize().padding(padding)) {
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    // On the tablet the switcher belongs to the content, as wide as the search field
                    // and the grid below. Next to an open set detail “Sets” stays selected.
                    if (art == NavigationMode.SIDEBAR && currentDest?.isOneOf(SAMMLUNG + SammlungZiel.SetDetail::class) == true) {
                        CollectionToggle(collectionTarget(currentDest),
                            onWahl = { ziel ->
                                onTabAngetippt(ziel)
                                navController.toTab(ziel)
                            })
                    }
                    // If an offline hint is shown, it names the pending changes itself.
                    if (offlineHints.intValue == 0) ExitBar(offeneAenderungen)
                    if (csvImport.lauf.laeuft) {
                        CsvImportBanner(
                            done = csvImport.done, total = csvImport.total, current = csvImport.current,
                            ok = csvImport.ok, warn = csvImport.warn, err = csvImport.err, running = csvImport.lauf.laeuft,
                            onAbbrechen = onCsvAbbrechen,
                        )
                    }
                    Box(Modifier.fillMaxSize()) {
                        CompositionLocalProvider(
                            LocalSnackbarSpace provides
                                with(LocalDensity.current) { snackbarHeight.toDp() },
                            LocalOpenChanges provides offeneAenderungen,
                            LocalOfflineHints provides offlineHints,
                        ) { content() }
                    }
                }
            }
        }
        }
    }
}

/**
 * The scaffold for a tab destination with everything that is the same in every destination
 * (discarding the scroll position, update dot). A new destination thus cannot
 * forget anything, because there is nothing to pass on. MainScaffold itself stays
 * for destinations that must deviate.
 */
@Composable
fun ReiterGeruest(
    titel: String,
    environment: TargetEnvironment,
    content: @Composable () -> Unit
) {
    val vm = environment.aktivitaet.app
    val selbstUpdate = environment.aktivitaet.update
    val updateZustand by selbstUpdate.updateState.collectAsStateWithLifecycle()
    val offen by vm.offeneAenderungen.collectAsStateWithLifecycle()
    val csvImport = environment.aktivitaet.csvImport
    MainScaffold(
        title = titel,
        navController = environment.navController,
        bottomNavItems = environment.tab,
        snackbarHostState = environment.snackbar,
        csvImportState = csvImport.csvImportState,
        onCsvAbbrechen = { csvImport.cancelCsvImport() },
        // Reiter angetippt → oben anfangen.
        onTabAngetippt = { ziel -> vm.scrollMemory.vergissReiter(rollSchluessel(ziel)) },
        // The silent start check has a result — here it gets a place.
        updateVerfuegbar = updateZustand.newerVersion != null,
        offeneAenderungen = offen,
        content = content
    )
}

/** A navigation destination: icon with indicator, below it the label or (without [groesse]) only its name. */
@Composable
private fun TabTarget(
    gewaehlt: Boolean, name: String, groesse: TextUnit?, farben: TabColors,
    onClick: () -> Unit, modifier: Modifier = Modifier, symbol: @Composable () -> Unit,
) {
    Column(
        modifier.focusFrame(Formen.kachel).selectable(selected = gewaehlt, onClick = onClick, role = Role.Tab)
            .then(if (groesse == null) Modifier.semantics { contentDescription = name } else Modifier)
            .padding(horizontal = Abstaende.tiny, vertical = Abstaende.mittel),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.tiny),
    ) {
        Box(
            Modifier.size(width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT)
                .background(if (gewaehlt) farben.anzeige else Color.Transparent, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            CompositionLocalProvider(LocalContentColor provides if (gewaehlt) farben.aufAnzeige else farben.ungewaehlt) { symbol() }
        }
        if (groesse != null) Text(
            name, style = MaterialTheme.typography.labelMedium.copy(fontSize = groesse),
            // Bold and in the primary color: the selected destination also differs in shape.
            fontWeight = if (gewaehlt) FontWeight.Bold else FontWeight.Medium,
            color = if (gewaehlt) farben.gewaehlt else farben.ungewaehlt,
            maxLines = 1, softWrap = false, overflow = TextOverflow.Clip,
        )
    }
}

/**
 * The bottom bar. All labels stand in one size and shrink at most
 * to one and a half times the normal size, otherwise the bar would override the system setting.
 * If the space is then not enough, only the selected destination is labelled and wider;
 * the others carry their name for TalkBack and as a tooltip.
 */
@Composable
private fun TabBar(
    targets: List<Reiter>,
    gewaehlt: (Any) -> Boolean, onWahl: (Any) -> Unit,
    symbol: @Composable (Any, @Composable () -> Unit) -> Unit,
) {
    val farben = tabColors(MaterialTheme.colorScheme)
    val stil = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold)
    val meter = rememberTextMeasurer()
    val dichte = LocalDensity.current
    Surface(color = farben.leiste) {
        // A margin left and right: at 200 % “More” including the dot hit the screen edge.
        BoxWithConstraints(Modifier.fillMaxWidth().windowInsetsPadding(NavigationBarDefaults.windowInsets)
            .padding(horizontal = BAR_EDGE)) {
            val satz = with(dichte) {
                tabSet(targets.map { meter.measure(it.beschriftung, stil).size.width.toFloat() },
                    targets.indexOfFirst { gewaehlt(it.ziel) }, maxWidth.toPx(), (Abstaende.tiny * 2).toPx(),
                    DISPLAY_MIN.toPx(), fontScale)
            }
            Row(Modifier.fillMaxWidth().heightIn(min = BAR_HEIGHT).selectableGroup(), verticalAlignment = Alignment.CenterVertically) {
                targets.forEachIndexed { i, (screen, icon, name) ->
                    val beschriftet = satz.alle || i == satz.gewaehlt
                    val space = Modifier.weight(if (i == satz.gewaehlt) satz.gewicht else 1f)
                    val ziel: @Composable (Modifier) -> Unit = { m ->
                        TabTarget(gewaehlt(screen), name, if (beschriftet) stil.fontSize * satz.faktor else null, farben,
                            { onWahl(screen) }, m) { symbol(screen, icon) }
                    }
                    if (beschriftet) ziel(space) else MitTooltip(name, space) { ziel(Modifier.fillMaxWidth()) }
                }
            }
        }
    }
}

/** The side bar becomes as wide as the longest label needs at full size. */
@Composable
private fun TabSidebar(
    targets: List<Reiter>,
    gewaehlt: (Any) -> Boolean, onWahl: (Any) -> Unit,
    symbol: @Composable (Any, @Composable () -> Unit) -> Unit,
) {
    val farben = tabColors(MaterialTheme.colorScheme)
    val groesse = MaterialTheme.typography.labelMedium.fontSize
    Surface(color = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier.fillMaxHeight().width(IntrinsicSize.Max).widthIn(min = SIDEBAR_WIDTH)
                .windowInsetsPadding(NavigationRailDefaults.windowInsets).padding(top = Abstaende.mittel).selectableGroup(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            targets.forEach { (screen, icon, name) ->
                TabTarget(gewaehlt(screen), name, groesse, farben, { onWahl(screen) }, Modifier.fillMaxWidth()) { symbol(screen, icon) }
            }
        }
    }
}

/** How the bottom bar is labelled: all with [faktor] of the full size, or only [gewaehlt] with [gewicht]. */
internal data class TabSet(val alle: Boolean, val faktor: Float, val gewaehlt: Int, val gewicht: Float)

/**
 * From the widths of the labels at full size ([widths], px, without [edge]) and the
 * font scale [schrift]: whether all fit, how far they shrink, otherwise how wide the selected destination becomes.
 */
internal fun tabSet(widths: List<Float>, gewaehlt: Int, gesamt: Float, edge: Float, minTarget: Float, schrift: Float): TabSet {
    val share = gesamt / widths.size - edge
    val floor = minOf(schrift, TAB_MIN_SCALE) / schrift
    val faktor = minOf(1f, share / (widths.maxOrNull() ?: 1f))
    if (faktor >= floor || gewaehlt < 0 || widths.size < 2) return TabSet(true, maxOf(faktor, floor), gewaehlt, 1f)
    val noetig = widths[gewaehlt] + edge
    val rest = (gesamt - noetig) / (widths.size - 1)
    if (rest >= minTarget) return TabSet(false, 1f, gewaehlt, noetig / rest)
    val frei = gesamt - minTarget * (widths.size - 1)
    return TabSet(false, ((frei - edge) / widths[gewaehlt]).coerceIn(floor, 1f), gewaehlt, frei / minTarget)
}

/** No label becomes smaller than one and a half times the normal size (WCAG 1.4.4). */
private const val TAB_MIN_SCALE = 1.5f
private val DISPLAY_WIDTH = 56.dp
private val DISPLAY_HEIGHT = 32.dp
/** Width of an unlabelled destination: indicator and margin. */
private val DISPLAY_MIN = 64.dp
private val BAR_HEIGHT = 80.dp
/** Distance of the outermost destinations to the screen edge. */
private val BAR_EDGE = 8.dp
private val SIDEBAR_WIDTH = 80.dp

/** The key of the remembered scroll position; destinations without a list have none of their own. */
internal fun rollSchluessel(ziel: Any): String = (ziel as? Reiterziel)?.rollSchluessel ?: ziel.toString()

/** The destinations of the switcher Sets | Parts | Minifigures, in its order. */
internal val COLLECTION_TARGETS: List<Any> = listOf(SammlungZiel.Gallery, TeileZiel.Parts, TeileZiel.Minifigs)

/** Sets, parts and minifigures share ONE destination in the bar. */
private val SAMMLUNG: Set<KClass<out Any>> = COLLECTION_TARGETS.map { it::class }.toSet()

/** Pages with a bottom bar that are reached via “More” — there “More” stays selected. */
private val MORE: Set<KClass<out Any>> = setOf(AppTarget.Mehr::class, TeileZiel.PartsList::class,
    SammlungZiel.Comparison::class, KontoZiel.Settings::class, ManagementTarget.Monitoring::class)

/** The destinations at which a bar destination counts as selected. */
private fun targetsOf(screen: Any): Set<KClass<out Any>> = when (screen) {
    SammlungZiel.Gallery -> SAMMLUNG + SammlungZiel.SetDetail::class
    AppTarget.Mehr -> MORE
    else -> setOf(screen::class)
}

private fun NavDestination.isOneOf(targets: Set<KClass<out Any>>) = targets.any { hasRoute(it) }

/** Which part of the collection is open; next to a set detail “Sets” stays selected. */
private fun collectionTarget(ziel: NavDestination): Any =
    COLLECTION_TARGETS.firstOrNull { ziel.hasRoute(it::class) } ?: SammlungZiel.Gallery

/** Like a tab: save the state of the others, do not stack twice. */
private fun androidx.navigation.NavController.toTab(ziel: Any) =
    navigate(ziel) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

/**
 * Sets | Parts | Minifigures — the same switcher as at the top of the web app. A change
 * of view, hence segments, also at 200 % font (then below each other).
 */
@Composable
private fun CollectionToggle(aktuell: Any, onWahl: (Any) -> Unit, modifier: Modifier = Modifier) {
    val texts = listOf(R.string.nav_sets, R.string.nav_parts, R.string.nav_minifigs)
    val targets = COLLECTION_TARGETS.zip(texts).map { (ziel, text) -> ziel to stringResource(text) }
    ViewToggle<Any?>(
        optionen = targets,
        gewaehlt = aktuell,
        onWahl = { if (it != null) onWahl(it) },
        modifier = modifier.padding(horizontal = Abstaende.mittel,
            vertical = Abstaende.tiny),
    )
}

/**
 * The switcher below the app bar yields with it: at 200 % font switcher and search
 * would otherwise stay, and hardly anything of the first set would be visible.
 */
private fun Modifier.withBarCollapse(share: () -> Float): Modifier = clipToBounds().layout { messbar, grenzen ->
    val space = messbar.measure(grenzen)
    val hoehe = (space.height * (1f - share())).roundToInt()
    layout(space.width, hoehe) { space.place(0, hoehe - space.height) }
}
