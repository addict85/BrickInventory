package ch.brickinventoryapp

import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import kotlin.math.roundToInt
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.isSpecified
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.screens.*
import ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel
import ch.brickinventoryapp.ui.viewmodel.UpdateViewModel

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
    bottomNavItems: List<Triple<Screen, @Composable () -> Unit, String>>,
    snackbarHostState: SnackbarHostState,
    csvImportState: kotlinx.coroutines.flow.StateFlow<CsvImportUiState>,
    /**
     * Laufenden CSV-Import abbrechen — der Knopf im Fortschrittsbalken. Als Rückruf,
     * weil dieses Gerüst nur Zustand und Rückrufe bekommt, kein ViewModel.
     */
    onCsvAbbrechen: () -> Unit,
    @Suppress("UNUSED_PARAMETER") serverUrl: String,
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
    onTabAngetippt: (Screen) -> Unit,
    /** Offline gespeicherte Änderungen, die noch zum Server müssen; 0 blendet die Leiste aus. */
    offeneAenderungen: Int = 0,
    content: @Composable () -> Unit
) {
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDest = navBackStackEntry?.destination
    val akzent = ch.brickinventoryapp.ui.theme.LocalAkzentflaechen.current
    // Die App-Leiste weicht beim Rollen nach unten und kommt beim Zurückrollen wieder:
    // Auf dem Telefon standen sonst Titel und Umschalter dauerhaft über dem Inhalt.
    // Ein neues Ziel beginnt mit sichtbarer Leiste.
    val einklappen = TopAppBarDefaults.enterAlwaysScrollBehavior()
    LaunchedEffect(currentDest?.route) { einklappen.state.heightOffset = 0f }

    fun istGewaehlt(screen: Screen) =
        currentDest?.hierarchy?.any { d -> d.route?.let { it in zieleVon(screen) } == true } == true

    // Leiste unten und Seitenleiste teilen sich diesen Weg, damit beide die
    // Rollposition gleich behandeln.
    fun reiterWaehlen(screen: Screen) {
        onTabAngetippt(screen)
        if (navController.currentBackStackEntry?.destination?.route == Screen.Monitoring.route) {
            navController.popBackStack()
        }
        navController.zuReiter(screen.route)
    }

    // Das Symbol eines Ziels, an „Mehr“ mit dem Punkt für eine neue Version.
    @Composable
    fun Symbol(screen: Screen, icon: @Composable () -> Unit) {
        if (screen == Screen.Mehr && updateVerfuegbar) BadgedBox(badge = { ch.brickinventoryapp.ui.components.UpdatePunkt() }) { icon() } else icon()
    }

    // Die Fensterbreite entscheidet, nicht das Gerät: Ein Tablet im geteilten
    // Bildschirm ist schmal und bekommt die Leiste unten.
    // Eine Grösse für alle Beschriftungen: Schrumpft jede für sich, steht „Sammlung“
    // klein neben grossem „Mehr“.
    val reiterSchrift = remember(LocalDensity.current.fontScale) { mutableStateOf(REITER_SCHRIFT_START) }
    // Die Snackbar liegt über dem Inhalt; ihre Höhe hebt den Erfassen-Knopf darüber.
    var snackbarHoehe by remember { mutableIntStateOf(0) }
    val offlineHinweise = remember { mutableIntStateOf(0) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val art = navigationsart(maxWidth.value)
        // Auf breiten Fenstern steht die Seitenleiste über die volle Höhe links, App-Leiste
        // und Inhalt rechts daneben — dieselben Ziele wie unten, „Mehr“ eingeschlossen.
        Row(Modifier.fillMaxSize()) {
        if (art == Navigationsart.SEITENLEISTE) {
            NavigationRail(containerColor = MaterialTheme.colorScheme.surface) {
                Spacer(Modifier.height(12.dp))
                bottomNavItems.forEach { (screen, icon, label) ->
                    NavigationRailItem(
                        selected = istGewaehlt(screen),
                        onClick = { reiterWaehlen(screen) },
                        icon = { Symbol(screen, icon) },
                        label = { ReiterBeschriftung(label, reiterSchrift) }
                    )
                }
            }
        }
        Scaffold(
            modifier = Modifier.weight(1f).nestedScroll(einklappen.nestedScrollConnection),
            topBar = {
              Column {
                TopAppBar(
                    title = {
                        // Der Seitentitel ist die Überschrift der Ansicht — Vorleseprogramme
                        // springen dorthin.
                        Row(Modifier.semantics(mergeDescendants = true) { heading() },
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            // Dasselbe Symbol wie in der unteren Leiste, damit oben und unten
                            // zusammenpassen.
                            val currentTabIcon = bottomNavItems.firstOrNull { (screen, _, _) ->
                                istGewaehlt(screen)
                            }?.second
                            if (currentTabIcon != null) {
                                Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
                                    currentTabIcon()
                                }
                            }
                            Text(title, fontWeight = FontWeight.SemiBold)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = akzent.leiste,
                        titleContentColor = akzent.aufLeiste,
                        actionIconContentColor = akzent.aufLeiste,
                        scrolledContainerColor = akzent.leiste,
                    ),
                    scrollBehavior = einklappen,
                )
                if (art == Navigationsart.LEISTE_UNTEN && currentDest?.route?.let { it in SAMMLUNG } == true) {
                    SammlungUmschalter(currentDest.route, onWahl = { ziel ->
                        onTabAngetippt(ziel)
                        navController.zuReiter(ziel.route)
                    }, modifier = Modifier.mitLeisteEinklappen { einklappen.state.collapsedFraction })
                }
              }
            },
            bottomBar = {
                if (art == Navigationsart.LEISTE_UNTEN) {
                    NavigationBar(
                        containerColor = MaterialTheme.colorScheme.surface,
                        tonalElevation = 3.dp
                    ) {
                        bottomNavItems.forEach { (screen, icon, label) ->
                            NavigationBarItem(
                                icon = { Symbol(screen, icon) },
                                label = { ReiterBeschriftung(label, reiterSchrift) },
                                selected = istGewaehlt(screen),
                                onClick = { reiterWaehlen(screen) }
                            )
                        }
                    }
                }
            },
            snackbarHost = { SnackbarHost(snackbarHostState, Modifier.onSizeChanged { snackbarHoehe = it.height }) },
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
        ) { padding ->
            // Globaler CSV-Import-Balken: erscheint auf allen Tabs (wie in der
            // Webapp), sobald ein Import läuft — egal von wo er gestartet wurde.
            val csvImport by csvImportState.collectAsStateWithLifecycle()
            Row(Modifier.fillMaxSize().padding(padding)) {
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    // Auf dem Tablet gehört der Umschalter zum Inhalt, so breit wie Suchfeld
                    // und Raster darunter. Neben einem offenen Set-Detail bleibt „Sets“ gewählt.
                    if (art == Navigationsart.SEITENLEISTE && currentDest?.route?.let { it in SAMMLUNG || it == Screen.SetDetail.route } == true) {
                        SammlungUmschalter(currentDest.route.takeUnless { it == Screen.SetDetail.route } ?: Screen.Gallery.route,
                            onWahl = { ziel ->
                                onTabAngetippt(ziel)
                                navController.zuReiter(ziel.route)
                            })
                    }
                    // Steht ein Offline-Hinweis, nennt er die wartenden Änderungen selbst.
                    if (offlineHinweise.intValue == 0) ch.brickinventoryapp.ui.components.AusgangLeiste(offeneAenderungen)
                    if (csvImport.running) {
                        CsvImportBanner(
                            done = csvImport.done, total = csvImport.total, current = csvImport.current,
                            ok = csvImport.ok, warn = csvImport.warn, err = csvImport.err, running = csvImport.running,
                            onAbbrechen = onCsvAbbrechen,
                        )
                    }
                    Box(Modifier.fillMaxSize()) {
                        CompositionLocalProvider(
                            ch.brickinventoryapp.ui.components.LocalSnackbarPlatz provides
                                with(LocalDensity.current) { snackbarHoehe.toDp() },
                            ch.brickinventoryapp.ui.components.LocalOffeneAenderungen provides offeneAenderungen,
                            ch.brickinventoryapp.ui.components.LocalOfflineHinweise provides offlineHinweise,
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
 * (Verwerfen der Rollposition, `serverUrl`, Update-Punkt). Ein neues Ziel kann so
 * nichts vergessen, weil es nichts weiterzureichen gibt. MainScaffold selbst bleibt
 * für Ziele, die abweichen müssen.
 */
@Composable
fun ReiterGeruest(
    titel: String,
    vm: ch.brickinventoryapp.ui.AppViewModel,
    navController: androidx.navigation.NavHostController,
    bottomNavItems: List<Triple<Screen, @Composable () -> Unit, String>>,
    snackbarHostState: SnackbarHostState,
    content: @Composable () -> Unit
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val selbstUpdate: UpdateViewModel = aktivitaetsViewModel()
    val updateZustand by selbstUpdate.updateState.collectAsStateWithLifecycle()
    val offen by vm.offeneAenderungen.collectAsStateWithLifecycle()
    MainScaffold(
        title = titel,
        navController = navController,
        bottomNavItems = bottomNavItems,
        snackbarHostState = snackbarHostState,
        csvImportState = vm.csvImportState,
        onCsvAbbrechen = { vm.cancelCsvImport() },
        // Reiter angetippt → oben anfangen.
        onTabAngetippt = { ziel -> vm.scrollMemory.vergissReiter(ziel.route) },
        serverUrl = state.serverUrl,
        // Der stille Start-Test hat ein Ergebnis — hier bekommt es einen Ort.
        updateVerfuegbar = updateZustand.neuereFassung != null,
        offeneAenderungen = offen,
        content = content
    )
}

/**
 * Beschriftung eines Ziels in Leiste und Seitenleiste: immer eine Zeile. Bei 200 %
 * brach „Samm|lung“ mitten im Wort; reicht die Breite nicht, wird die Schrift
 * schrittweise kleiner, wie Android es in der eigenen Systemleiste hält.
 */
@Composable
private fun ReiterBeschriftung(text: String, groesse: MutableState<TextUnit>) {
    val stil = MaterialTheme.typography.labelSmall
    // Jede Messung mit Überstand verkleinert die gemeinsame Grösse um einen halben
    // Punkt, bis jedes Wort ganz in eine Zeile passt.
    val aktuell = if (groesse.value.isSpecified) groesse.value else stil.fontSize
    Text(
        text, style = stil.copy(fontSize = aktuell), maxLines = 1, softWrap = false,
        overflow = TextOverflow.Clip,
        onTextLayout = { l ->
            if (l.hasVisualOverflow && aktuell > REITER_SCHRIFT_MIN) groesse.value = (aktuell.value - 0.5f).sp
        },
    )
}

/** Unbestimmt: Die Beschriftung beginnt bei der Grösse des Themas. */
private val REITER_SCHRIFT_START = TextUnit.Unspecified

/** Kleiner wird keine Beschriftung; bei 200 % sind das noch 14 dp, gut lesbar. */
private val REITER_SCHRIFT_MIN = 7.sp

/** Sets, Teile und Minifiguren teilen sich in der Leiste EIN Ziel. */
private val SAMMLUNG = setOf(Screen.Gallery.route, Screen.Parts.route, Screen.Minifigs.route)

/** Seiten mit unterer Leiste, die man über „Mehr“ erreicht — dort bleibt „Mehr“ gewählt. */
private val MEHR = setOf(Screen.Mehr.route, Screen.PartsList.route, Screen.Settings.route, Screen.Monitoring.route)

/** Die Routen, bei denen ein Ziel der Leiste als gewaehlt gilt. */
private fun zieleVon(screen: Screen): Set<String> = when (screen) {
    Screen.Gallery -> SAMMLUNG + Screen.SetDetail.route
    Screen.Mehr -> MEHR
    else -> setOf(screen.route)
}

/** Wie ein Reiter: Zustand der anderen sichern, nicht doppelt stapeln. */
private fun androidx.navigation.NavController.zuReiter(route: String) =
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

/**
 * Sets | Teile | Minifiguren — derselbe Umschalter wie oben in der Webapp. Über
 * SegmentWahl, damit er bei grosser Schrift wie jede Einfachwahl zu Chips wird.
 */
@Composable
private fun SammlungUmschalter(aktuell: String?, onWahl: (Screen) -> Unit, modifier: Modifier = Modifier) {
    val ziele = listOf(
        Screen.Gallery to R.string.gallery_stat_sets,
        Screen.Parts to R.string.nav_parts,
        Screen.Minifigs to R.string.nav_minifigs,
    ).map { (ziel, text) -> ziel to stringResource(text) }
    ch.brickinventoryapp.ui.components.SegmentWahl<Screen?>(
        optionen = ziele,
        gewaehlt = ziele.firstOrNull { it.first.route == aktuell }?.first,
        onWahl = { if (it != null) onWahl(it) },
        modifier = modifier.padding(horizontal = ch.brickinventoryapp.ui.theme.Abstaende.mittel,
            vertical = ch.brickinventoryapp.ui.theme.Abstaende.winzig),
    )
}

/**
 * Der Umschalter unter der App-Leiste weicht mit ihr: Bei 200 % Schrift blieben
 * sonst Umschalter und Suche stehen, und vom ersten Set war kaum etwas zu sehen.
 */
private fun Modifier.mitLeisteEinklappen(anteil: () -> Float): Modifier = clipToBounds().layout { messbar, grenzen ->
    val platz = messbar.measure(grenzen)
    val hoehe = (platz.height * (1f - anteil())).roundToInt()
    layout(platz.width, hoehe) { platz.place(0, hoehe - platz.height) }
}
