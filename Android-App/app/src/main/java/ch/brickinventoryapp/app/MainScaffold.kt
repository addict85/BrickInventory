package ch.brickinventoryapp.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import androidx.navigation.NavDestination
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import ch.brickinventoryapp.account.ui.AccountTarget
import ch.brickinventoryapp.app.csv.CsvImportUiState
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.app.nav.Tab
import ch.brickinventoryapp.app.nav.TargetEnvironment
import ch.brickinventoryapp.app.ui.components.CsvImportBanner
import ch.brickinventoryapp.app.ui.components.CsvProgress
import ch.brickinventoryapp.collection.ui.CollectionTarget
import ch.brickinventoryapp.management.ui.ManagementTarget
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.parts.ui.PartsTarget
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.NavigationMode
import ch.brickinventoryapp.ui.TabTarget
import ch.brickinventoryapp.ui.components.LocalOfflineHints
import ch.brickinventoryapp.ui.components.LocalOpenChanges
import ch.brickinventoryapp.ui.components.LocalSnackbarSpace
import ch.brickinventoryapp.ui.components.OutboxBar
import ch.brickinventoryapp.ui.components.ViewToggle
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.focusFrame
import ch.brickinventoryapp.ui.forgetTab
import ch.brickinventoryapp.ui.navigationMode
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.LocalAccentSurfaces
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.TabColors
import ch.brickinventoryapp.ui.theme.tabColors
import ch.brickinventoryapp.ui.title
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.roundToInt
import kotlin.reflect.KClass

/** The CSV import for the bar above the content: its state, and how to cancel it from the bar. */
class CsvImportBar(val state: StateFlow<CsvImportUiState>, val onCancel: () -> Unit)

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
    navController: NavController,
    bottomNavItems: List<Tab>,
    snackbarHostState: SnackbarHostState,
    /**
     * A tab was tapped at the bottom — discard its remembered scroll position. “I
     * come back” keeps the position, “I go to this tab” starts at the top
     * (where the manually added entries are); this can only be distinguished
     * here. Without a default value, so that an integration that forgets it does not
     * compile.
     */
    onTabTapped: (Any) -> Unit,
    /** The running CSV import, shown on every tab as in the web app; null: no import bar. */
    csvImport: CsvImportBar? = null,
    /** Changes saved offline that still have to go to the server; 0 hides the bar. */
    pendingChanges: Int = 0,
    content: @Composable () -> Unit
) {
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDest = navBackStackEntry?.destination
    // The app bar yields when scrolling down and comes back when scrolling back:
    // on the phone title and switcher otherwise stood permanently above the content.
    // A new destination starts with a visible bar.
    val collapse = TopAppBarDefaults.enterAlwaysScrollBehavior()
    LaunchedEffect(currentDest?.id) { collapse.state.heightOffset = 0f }

    fun isSelected(screen: Any) =
        currentDest?.hierarchy?.any { d -> d.isOneOf(targetsOf(screen)) } == true

    // Bottom bar and side bar share this path so that both treat the
    // scroll position the same.
    fun tabChoose(screen: Any) {
        onTabTapped(screen)
        if (navController.currentBackStackEntry?.destination?.hasRoute<ManagementTarget.Monitoring>() == true) {
            navController.popBackStack()
        }
        navController.toTab(screen)
    }
    val toggle: (Any) -> Unit = { target ->
        onTabTapped(target)
        navController.toTab(target)
    }

    // The window width decides, not the device: a tablet in split
    // screen is narrow and gets the bar at the bottom.
    // The snackbar lies above the content; its height lifts the add button above it.
    var snackbarHeight by remember { mutableIntStateOf(0) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val kind = navigationMode(maxWidth.value)
        // On wide windows the side bar stands at full height on the left, app bar
        // and content to the right of it — the same destinations as below, “More” included.
        Row(Modifier.fillMaxSize()) {
        if (kind == NavigationMode.SIDEBAR) TabSidebar(bottomNavItems, ::isSelected, ::tabChoose)
        Scaffold(
            modifier = Modifier.weight(1f).nestedScroll(collapse.nestedScrollConnection),
            topBar = {
              Column {
                MainTopBar(title, navController, currentDest, collapse)
                if (kind == NavigationMode.BAR_BOTTOM && currentDest?.isOneOf(COLLECTION) == true) {
                    CollectionToggle(collectionTarget(currentDest), onChoice = toggle,
                        modifier = Modifier.withBarCollapse { collapse.state.collapsedFraction })
                }
              }
            },
            bottomBar = {
                if (kind == NavigationMode.BAR_BOTTOM) TabBar(bottomNavItems, ::isSelected, ::tabChoose)
            },
            snackbarHost = { SnackbarHost(snackbarHostState, Modifier.onSizeChanged { snackbarHeight = it.height }) },
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
        ) { padding ->
            Row(Modifier.fillMaxSize().padding(padding)) {
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    // On the tablet the switcher belongs to the content, as wide as the search field
                    // and the grid below. Next to an open set detail “Sets” stays selected.
                    if (kind == NavigationMode.SIDEBAR && currentDest?.isOneOf(COLLECTION + CollectionTarget.SetDetail::class) == true) {
                        CollectionToggle(collectionTarget(currentDest), onChoice = toggle)
                    }
                    MainContent(csvImport, pendingChanges, with(LocalDensity.current) { snackbarHeight.toDp() }, content)
                }
            }
        }
        }
    }
}

/**
 * Plain text like every Material title: an icon in front read like a menu button
 * on “More”. Screen readers jump to the heading.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainTopBar(title: String, navController: NavController, currentDest: NavDestination?, collapse: TopAppBarScrollBehavior) {
    val accent = LocalAccentSurfaces.current
    // Subpages of “More” with a bottom bar carry the back arrow like the other
    // More subpages. It goes the same way as the back gesture: if both led to
    // different places, one would not know before tapping where one lands. Only without
    // a previous entry (entry from outside) does it lead to “More”.
    val moreSubpage = currentDest != null && currentDest.isOneOf(MORE) && !currentDest.hasRoute<AppTarget.More>()
    fun backFromMore() {
        if (navController.previousBackStackEntry != null && navController.popBackStack()) return
        if (!navController.popBackStack(AppTarget.More, inclusive = false)) navController.toTab(AppTarget.More)
    }
    TopAppBar(
        title = { Text(title, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) },
        navigationIcon = {
            if (moreSubpage) WithTooltip(stringResource(R.string.common_back)) {
                IconButton(onClick = { backFromMore() }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.common_back))
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = accent.bar,
            titleContentColor = accent.onBar,
            navigationIconContentColor = accent.onBar,
            actionIconContentColor = accent.onBar,
            scrolledContainerColor = accent.bar,
        ),
        scrollBehavior = collapse,
    )
}

/** Outbox and CSV bars above the destination's content, and what the content learns from the scaffold. */
@Composable
private fun MainContent(
    csvImport: CsvImportBar?,
    pendingChanges: Int,
    snackbarSpace: Dp,
    content: @Composable () -> Unit,
) {
    val offlineHints = remember { mutableIntStateOf(0) }
    // If an offline hint is shown, it names the pending changes itself.
    if (offlineHints.intValue == 0) OutboxBar(pendingChanges)
    // Global CSV import bar: appears on all tabs (as in the
    // web app) as soon as an import runs — no matter where it was started.
    if (csvImport != null) {
        val state by csvImport.state.collectAsStateWithLifecycle()
        if (state.jobRun.running) {
            CsvImportBanner(
                CsvProgress(done = state.done, total = state.total, current = state.current,
                    ok = state.ok, warn = state.warn, err = state.err),
                running = state.jobRun.running,
                onCancel = csvImport.onCancel,
            )
        }
    }
    Box(Modifier.fillMaxSize()) {
        CompositionLocalProvider(
            LocalSnackbarSpace provides snackbarSpace,
            LocalOpenChanges provides pendingChanges,
            LocalOfflineHints provides offlineHints,
        ) { content() }
    }
}
/**
 * The scaffold for a tab destination with everything that is the same in every destination
 * (discarding the scroll position, pending changes). A new destination thus cannot
 * forget anything, because there is nothing to pass on. MainScaffold itself stays
 * for destinations that must deviate.
 */
@Composable
fun TabScaffold(
    title: String,
    environment: TargetEnvironment,
    content: @Composable () -> Unit
) {
    val vm = environment.activity.app
    val open by vm.pendingChanges.collectAsStateWithLifecycle()
    val csvImport = environment.activity.csvImport
    MainScaffold(
        title = title,
        navController = environment.navController,
        bottomNavItems = environment.tab,
        snackbarHostState = environment.snackbar,
        csvImport = CsvImportBar(csvImport.csvImportState) { csvImport.cancelCsvImport() },
        // Tab tapped → start at the top.
        onTabTapped = { target -> vm.scrollMemory.forgetTab(rollKey(target)) },
        pendingChanges = open,
        content = content
    )
}

/** A navigation destination: icon with indicator, below it the label or (without [size]) only its name. */
@Composable
private fun TabTarget(
    chosen: Boolean, name: String, size: TextUnit?, colors: TabColors,
    onClick: () -> Unit, modifier: Modifier = Modifier, symbol: @Composable () -> Unit,
) {
    Column(
        modifier.focusFrame(Shapes.tile).selectable(selected = chosen, onClick = onClick, role = Role.Tab)
            .then(if (size == null) Modifier.semantics { contentDescription = name } else Modifier)
            .padding(horizontal = Spacing.tiny, vertical = Spacing.medium),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.tiny),
    ) {
        Box(
            Modifier.size(width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT)
                .background(if (chosen) colors.display else Color.Transparent, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            CompositionLocalProvider(LocalContentColor provides if (chosen) colors.onDisplay else colors.unselected) { symbol() }
        }
        if (size != null) Text(
            name, style = MaterialTheme.typography.labelMedium.copy(fontSize = size),
            // Bold and in the primary color: the selected destination also differs in shape.
            fontWeight = if (chosen) FontWeight.Bold else FontWeight.Medium,
            color = if (chosen) colors.chosen else colors.unselected,
            maxLines = 1, softWrap = false, overflow = TextOverflow.Clip,
        )
    }
}

/**
 * The bottom bar: Material's NavigationBar, every destination labelled in one size. Labels
 * shrink at most to one and a half times the normal size, otherwise the bar would override the
 * system setting; if even that does not fit, only the selected destination keeps its label and
 * grows wider, the others carry their name for TalkBack and as a tooltip.
 */
@Composable
private fun TabBar(
    targets: List<Tab>,
    chosen: (Any) -> Boolean, onChoice: (Any) -> Unit,
) {
    val colors = tabColors(MaterialTheme.colorScheme)
    val style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold)
    val meter = rememberTextMeasurer()
    val density = LocalDensity.current
    val direction = LocalLayoutDirection.current
    // A margin left and right: at 200 % “More” hit the screen edge.
    val insets = NavigationBarDefaults.windowInsets.add(WindowInsets(left = BAR_EDGE, right = BAR_EDGE))
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val sentence = with(density) {
            val inner = maxWidth.toPx() - insets.getLeft(this, direction) - insets.getRight(this, direction) -
                ITEM_GAP.toPx() * (targets.size - 1)
            tabSet(targets.map { meter.measure(it.label, style).size.width.toFloat() },
                targets.indexOfFirst { chosen(it.target) }, inner, LABEL_SLACK.toPx(),
                DISPLAY_MIN.toPx(), fontScale)
        }
        NavigationBar(containerColor = colors.bar, windowInsets = insets) {
            targets.forEachIndexed { i, (screen, icon, name) ->
                val labeled = sentence.all || i == sentence.chosen
                // NavigationBarItem weighs itself 1f; the wider selected destination needs its own Row.
                Row(Modifier.weight(if (i == sentence.chosen) sentence.weight else 1f)) {
                    val item: @Composable RowScope.() -> Unit = {
                        TabItem(chosen(screen), name, if (labeled) style.fontSize * sentence.factor else null, colors,
                            { onChoice(screen) }) { icon() }
                    }
                    if (labeled) item() else WithTooltip(name, Modifier.fillMaxWidth()) { Row { item() } }
                }
            }
        }
    }
}

/**
 * One destination of the bottom bar. The indicator stays in the full main color: Material's
 * secondaryContainer barely stood out from the bar (tabColors).
 */
@Composable
private fun RowScope.TabItem(
    chosen: Boolean, name: String, size: TextUnit?, colors: TabColors,
    onClick: () -> Unit, symbol: @Composable () -> Unit,
) {
    NavigationBarItem(
        selected = chosen, onClick = onClick, icon = symbol,
        modifier = Modifier.focusFrame(Shapes.tile)
            .then(if (size == null) Modifier.semantics { contentDescription = name } else Modifier),
        label = size?.let { s ->
            {
                // Only as wide as the text: the slot is wider, and an unwrapped line laid out
                // at slot width counts as overflowing.
                Text(name, Modifier.width(IntrinsicSize.Max), fontSize = s,
                    fontWeight = if (chosen) FontWeight.Bold else FontWeight.Medium,
                    maxLines = 1, softWrap = false, overflow = TextOverflow.Clip)
            }
        },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = colors.onDisplay, selectedTextColor = colors.chosen, indicatorColor = colors.display,
            unselectedIconColor = colors.unselected, unselectedTextColor = colors.unselected,
        ),
    )
}

/** The side bar becomes as wide as the longest label needs at full size. */
@Composable
private fun TabSidebar(
    targets: List<Tab>,
    chosen: (Any) -> Boolean, onChoice: (Any) -> Unit,
) {
    val colors = tabColors(MaterialTheme.colorScheme)
    val size = MaterialTheme.typography.labelMedium.fontSize
    Surface(color = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier.fillMaxHeight().width(IntrinsicSize.Max).widthIn(min = SIDEBAR_WIDTH)
                .windowInsetsPadding(NavigationRailDefaults.windowInsets).padding(top = Spacing.medium).selectableGroup(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            targets.forEach { (screen, icon, name) ->
                TabTarget(chosen(screen), name, size, colors, { onChoice(screen) }, Modifier.fillMaxWidth()) { icon() }
            }
        }
    }
}

/** How the bottom bar is labelled: all with [factor] of the full size, or only [chosen] with [weight]. */
internal data class TabSet(val all: Boolean, val factor: Float, val chosen: Int, val weight: Float)

/**
 * From the widths of the labels at full size ([widths], px, without [edge]) and the
 * font scale [font]: whether all fit, how far they shrink, otherwise how wide the selected destination becomes.
 */
internal fun tabSet(widths: List<Float>, chosen: Int, total: Float, edge: Float, minTarget: Float, font: Float): TabSet {
    val share = total / widths.size - edge
    val floor = minOf(font, TAB_MIN_SCALE) / font
    val factor = minOf(1f, share / (widths.maxOrNull() ?: 1f))
    if (factor >= floor || chosen < 0 || widths.size < 2) return TabSet(true, maxOf(factor, floor), chosen, 1f)
    val needed = widths[chosen] + edge
    val rest = (total - needed) / (widths.size - 1)
    if (rest >= minTarget) return TabSet(false, 1f, chosen, needed / rest)
    val free = total - minTarget * (widths.size - 1)
    return TabSet(false, ((free - edge) / widths[chosen]).coerceIn(floor, 1f), chosen, free / minTarget)
}

/** No label becomes smaller than one and a half times the normal size (WCAG 1.4.4). */
private const val TAB_MIN_SCALE = 1.5f
private val DISPLAY_WIDTH = 56.dp
private val DISPLAY_HEIGHT = 32.dp
/** Width of an unlabelled destination: indicator and margin. */
private val DISPLAY_MIN = 64.dp
/** Material's gap between two NavigationBarItems; the labels have to fit without it. */
private val ITEM_GAP = 8.dp
/**
 * The label may use its whole item; 2 dp absorb rounding. More, and „Sammlung“ no longer
 * fitted a fifth of a phone at normal size: only the selected destination was labelled.
 */
private val LABEL_SLACK = 2.dp
/** Distance of the outermost destinations to the screen edge. */
private val BAR_EDGE = 8.dp
private val SIDEBAR_WIDTH = 80.dp

/** The key of the remembered scroll position; destinations without a list have none of their own. */
internal fun rollKey(target: Any): String = (target as? TabTarget)?.rollKey ?: target.toString()

/** The destinations of the switcher Sets | Parts | Minifigures, in its order. */
internal val COLLECTION_TARGETS: List<Any> = listOf(CollectionTarget.Gallery, PartsTarget.Parts, PartsTarget.Minifigs)

/** Sets, parts and minifigures share ONE destination in the bar. */
private val COLLECTION: Set<KClass<out Any>> = COLLECTION_TARGETS.map { it::class }.toSet()

/** Pages with a bottom bar that are reached via “More” — there “More” stays selected. */
private val MORE: Set<KClass<out Any>> = setOf(AppTarget.More::class, PartsTarget.PartsList::class,
    CollectionTarget.Wanted::class, CollectionTarget.WantedItemDetail::class,
    AccountTarget.Settings::class, ManagementTarget.Monitoring::class)

/** The destinations at which a bar destination counts as selected. */
private fun targetsOf(screen: Any): Set<KClass<out Any>> = when (screen) {
    CollectionTarget.Gallery -> COLLECTION + CollectionTarget.SetDetail::class
    AppTarget.More -> MORE
    else -> setOf(screen::class)
}

private fun NavDestination.isOneOf(targets: Set<KClass<out Any>>) = targets.any { hasRoute(it) }

/** Which part of the collection is open; next to a set detail “Sets” stays selected. */
private fun collectionTarget(target: NavDestination): Any =
    COLLECTION_TARGETS.firstOrNull { target.hasRoute(it::class) } ?: CollectionTarget.Gallery

/** Like a tab: save the state of the others, do not stack twice. */
private fun androidx.navigation.NavController.toTab(target: Any) =
    navigate(target) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

/**
 * Sets | Parts | Minifigures — the same switcher as at the top of the web app. A change
 * of view, hence segments, also at 200 % font (then below each other).
 */
@Composable
private fun CollectionToggle(current: Any, onChoice: (Any) -> Unit, modifier: Modifier = Modifier) {
    val texts = listOf(R.string.nav_sets, R.string.nav_parts, R.string.nav_minifigs)
    val targets = COLLECTION_TARGETS.zip(texts).map { (target, text) -> target to stringResource(text) }
    ViewToggle<Any?>(
        options = targets,
        chosen = current,
        onChoice = { if (it != null) onChoice(it) },
        modifier = modifier.padding(horizontal = Spacing.medium,
            vertical = Spacing.tiny),
    )
}

/**
 * The switcher below the app bar yields with it: at 200 % font switcher and search
 * would otherwise stay, and hardly anything of the first set would be visible.
 */
private fun Modifier.withBarCollapse(share: () -> Float): Modifier = clipToBounds().layout { measurable, limits ->
    val space = measurable.measure(limits)
    val height = (space.height * (1f - share())).roundToInt()
    layout(space.width, height) { space.place(0, height - space.height) }
}
