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
 * Gemeinsames Gerüst aller eingeloggten Screens: obere Leiste mit Titel und
 * Reiter-Icon, untere Navigation (auf breiten Fenstern die Seitenleiste), Snackbar
 * und der CSV-Import-Balken. Es bekommt alles über seine Parameter und greift auf
 * nichts aus dem umgebenden Composable zu.
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
     * Laufenden CSV-Import abbrechen — der Knopf im Fortschrittsbalken. Als Rückruf,
     * weil dieses Gerüst nur Zustand und Rückrufe bekommt, kein ViewModel.
     */
    onCsvAbbrechen: () -> Unit,
    /**
     * Liegt eine neuere Version bereit? Die Prüfung läuft app-weit beim Start; das
     * Gerüst zeigt den Befund als Punkt am Ziel „Mehr“, dort steht er an den
     * Einstellungen noch einmal. Geladen wird nie von allein.
     */
    updateVerfuegbar: Boolean = false,
    /**
     * Ein Reiter wurde unten angetippt — seine gemerkte Rollposition verwerfen. „Ich
     * komme zurück“ behält die Stelle, „ich gehe auf diesen Reiter“ fängt oben an
     * (dort stehen die manuell erfassten Einträge); unterscheiden lässt sich das nur
     * hier. Ohne Vorgabewert, damit eine Einbindung, die ihn vergisst, nicht
     * übersetzt.
     */
    onTabAngetippt: (Any) -> Unit,
    /** Offline gespeicherte Änderungen, die noch zum Server müssen; 0 blendet die Leiste aus. */
    offeneAenderungen: Int = 0,
    content: @Composable () -> Unit
) {
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDest = navBackStackEntry?.destination
    val accent = LocalAkzentflaechen.current
    // Die App-Leiste weicht beim Rollen nach unten und kommt beim Zurückrollen wieder:
    // Auf dem Telefon standen sonst Titel und Umschalter dauerhaft über dem Inhalt.
    // Ein neues Ziel beginnt mit sichtbarer Leiste.
    val collapse = TopAppBarDefaults.enterAlwaysScrollBehavior()
    LaunchedEffect(currentDest?.id) { collapse.state.heightOffset = 0f }

    fun isSelected(screen: Any) =
        currentDest?.hierarchy?.any { d -> d.isOneOf(targetsOf(screen)) } == true

    // Unterseiten von „Mehr“ mit unterer Leiste tragen den Zurück-Pfeil wie die übrigen
    // Mehr-Unterseiten. Er geht denselben Weg wie die Zurück-Geste: Führten beide an
    // verschiedene Orte, wüsste man vor dem Tippen nicht, wo man landet. Nur ohne
    // vorigen Eintrag (Einstieg von aussen) führt er auf „Mehr“.
    val moreSubpage = currentDest != null && currentDest.isOneOf(MORE) && !currentDest.hasRoute<AppTarget.Mehr>()
    fun backFromMore() {
        if (navController.previousBackStackEntry != null && navController.popBackStack()) return
        if (!navController.popBackStack(AppTarget.Mehr, inclusive = false)) navController.toTab(AppTarget.Mehr)
    }

    // Leiste unten und Seitenleiste teilen sich diesen Weg, damit beide die
    // Rollposition gleich behandeln.
    fun tabChoose(screen: Any) {
        onTabAngetippt(screen)
        if (navController.currentBackStackEntry?.destination?.hasRoute<ManagementTarget.Monitoring>() == true) {
            navController.popBackStack()
        }
        navController.toTab(screen)
    }

    // Das Symbol eines Ziels, an „Mehr“ mit dem Punkt für eine neue Version.
    @Composable
    fun Symbol(screen: Any, icon: @Composable () -> Unit) {
        if (screen == AppTarget.Mehr && updateVerfuegbar) BadgedBox(badge = { UpdatePoint() }) { icon() } else icon()
    }

    // Die Fensterbreite entscheidet, nicht das Gerät: Ein Tablet im geteilten
    // Bildschirm ist schmal und bekommt die Leiste unten.
    // Die Snackbar liegt über dem Inhalt; ihre Höhe hebt den Erfassen-Knopf darüber.
    var snackbarHeight by remember { mutableIntStateOf(0) }
    val offlineHints = remember { mutableIntStateOf(0) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val art = navigationMode(maxWidth.value)
        // Auf breiten Fenstern steht die Seitenleiste über die volle Höhe links, App-Leiste
        // und Inhalt rechts daneben — dieselben Ziele wie unten, „Mehr“ eingeschlossen.
        Row(Modifier.fillMaxSize()) {
        if (art == NavigationMode.SIDEBAR) {
            TabSidebar(bottomNavItems, ::isSelected, ::tabChoose) { screen, icon -> Symbol(screen, icon) }
        }
        Scaffold(
            modifier = Modifier.weight(1f).nestedScroll(collapse.nestedScrollConnection),
            topBar = {
              Column {
                TopAppBar(
                    // Reiner Text wie jeder Material-Titel: Ein Symbol davor las sich bei
                    // „Mehr“ als Menüknopf. Vorleseprogramme springen zur Überschrift.
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
            // Globaler CSV-Import-Balken: erscheint auf allen Tabs (wie in der
            // Webapp), sobald ein Import läuft — egal von wo er gestartet wurde.
            val csvImport by csvImportState.collectAsStateWithLifecycle()
            Row(Modifier.fillMaxSize().padding(padding)) {
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    // Auf dem Tablet gehört der Umschalter zum Inhalt, so breit wie Suchfeld
                    // und Raster darunter. Neben einem offenen Set-Detail bleibt „Sets“ gewählt.
                    if (art == NavigationMode.SIDEBAR && currentDest?.isOneOf(SAMMLUNG + SammlungZiel.SetDetail::class) == true) {
                        CollectionToggle(collectionTarget(currentDest),
                            onWahl = { ziel ->
                                onTabAngetippt(ziel)
                                navController.toTab(ziel)
                            })
                    }
                    // Steht ein Offline-Hinweis, nennt er die wartenden Änderungen selbst.
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
 * Das Gerüst für ein Reiter-Ziel mit allem, was in jedem Ziel gleich ist
 * (Verwerfen der Rollposition, Update-Punkt). Ein neues Ziel kann so
 * nichts vergessen, weil es nichts weiterzureichen gibt. MainScaffold selbst bleibt
 * für Ziele, die abweichen müssen.
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
        // Der stille Start-Test hat ein Ergebnis — hier bekommt es einen Ort.
        updateVerfuegbar = updateZustand.newerVersion != null,
        offeneAenderungen = offen,
        content = content
    )
}

/** Ein Ziel der Navigation: Symbol mit Anzeige, darunter die Beschriftung oder (ohne [groesse]) nur ihr Name. */
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
            // Fett und in Hauptfarbe: Das gewählte Ziel unterscheidet sich auch in der Form.
            fontWeight = if (gewaehlt) FontWeight.Bold else FontWeight.Medium,
            color = if (gewaehlt) farben.gewaehlt else farben.ungewaehlt,
            maxLines = 1, softWrap = false, overflow = TextOverflow.Clip,
        )
    }
}

/**
 * Die Leiste unten. Alle Beschriftungen stehen in einer Grösse und schrumpfen höchstens
 * bis zum Anderthalbfachen der Normalgrösse, sonst höbe die Leiste die Systemeinstellung
 * auf. Reicht der Platz dann nicht, ist nur das gewählte Ziel beschriftet und breiter;
 * die übrigen tragen ihren Namen für TalkBack und als Tooltip.
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
        // Ein Rand links und rechts: Bei 200 % stiess „Mehr“ samt Punkt an den Bildschirmrand.
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

/** Die Seitenleiste wird so breit, wie die längste Beschriftung in voller Grösse braucht. */
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

/** Wie die Leiste unten beschriftet ist: alle mit [faktor] der vollen Grösse, oder nur [gewaehlt] mit [gewicht]. */
internal data class TabSet(val alle: Boolean, val faktor: Float, val gewaehlt: Int, val gewicht: Float)

/**
 * Aus den Breiten der Beschriftungen in voller Grösse ([widths], px, ohne [edge]) und der
 * Schriftskala [schrift]: ob alle passen, wie weit sie schrumpfen, sonst wie breit das gewählte Ziel wird.
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

/** Kleiner als das Anderthalbfache der Normalgrösse wird keine Beschriftung (WCAG 1.4.4). */
private const val TAB_MIN_SCALE = 1.5f
private val DISPLAY_WIDTH = 56.dp
private val DISPLAY_HEIGHT = 32.dp
/** Breite eines unbeschrifteten Ziels: Anzeige und Rand. */
private val DISPLAY_MIN = 64.dp
private val BAR_HEIGHT = 80.dp
/** Abstand der äussersten Ziele zum Bildschirmrand. */
private val BAR_EDGE = 8.dp
private val SIDEBAR_WIDTH = 80.dp

/** Der Schlüssel der gemerkten Rollposition; Ziele ohne Liste haben keinen eigenen. */
internal fun rollSchluessel(ziel: Any): String = (ziel as? Reiterziel)?.rollSchluessel ?: ziel.toString()

/** Die Ziele des Umschalters Sets | Teile | Minifiguren, in seiner Reihenfolge. */
internal val COLLECTION_TARGETS: List<Any> = listOf(SammlungZiel.Gallery, TeileZiel.Parts, TeileZiel.Minifigs)

/** Sets, Teile und Minifiguren teilen sich in der Leiste EIN Ziel. */
private val SAMMLUNG: Set<KClass<out Any>> = COLLECTION_TARGETS.map { it::class }.toSet()

/** Seiten mit unterer Leiste, die man über „Mehr“ erreicht — dort bleibt „Mehr“ gewählt. */
private val MORE: Set<KClass<out Any>> = setOf(AppTarget.Mehr::class, TeileZiel.PartsList::class,
    SammlungZiel.Comparison::class, KontoZiel.Settings::class, ManagementTarget.Monitoring::class)

/** Die Ziele, bei denen ein Ziel der Leiste als gewählt gilt. */
private fun targetsOf(screen: Any): Set<KClass<out Any>> = when (screen) {
    SammlungZiel.Gallery -> SAMMLUNG + SammlungZiel.SetDetail::class
    AppTarget.Mehr -> MORE
    else -> setOf(screen::class)
}

private fun NavDestination.isOneOf(targets: Set<KClass<out Any>>) = targets.any { hasRoute(it) }

/** Welcher Teil der Sammlung offen ist; neben einem Set-Detail bleibt „Sets“ gewählt. */
private fun collectionTarget(ziel: NavDestination): Any =
    COLLECTION_TARGETS.firstOrNull { ziel.hasRoute(it::class) } ?: SammlungZiel.Gallery

/** Wie ein Reiter: Zustand der anderen sichern, nicht doppelt stapeln. */
private fun androidx.navigation.NavController.toTab(ziel: Any) =
    navigate(ziel) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

/**
 * Sets | Teile | Minifiguren — derselbe Umschalter wie oben in der Webapp. Ein Wechsel
 * der Ansicht, darum Segmente, auch bei 200 % Schrift (dann untereinander).
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
 * Der Umschalter unter der App-Leiste weicht mit ihr: Bei 200 % Schrift blieben
 * sonst Umschalter und Suche stehen, und vom ersten Set war kaum etwas zu sehen.
 */
private fun Modifier.withBarCollapse(share: () -> Float): Modifier = clipToBounds().layout { messbar, grenzen ->
    val space = messbar.measure(grenzen)
    val hoehe = (space.height * (1f - share())).roundToInt()
    layout(space.width, hoehe) { space.place(0, hoehe - space.height) }
}
