package ch.brickinventoryapp

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
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.isSpecified
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination
import androidx.navigation.NavDestination.Companion.hasRoute
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
    LaunchedEffect(currentDest?.id) { einklappen.state.heightOffset = 0f }

    fun istGewaehlt(screen: Screen) =
        currentDest?.hierarchy?.any { d -> d.istEinesVon(zieleVon(screen)) } == true

    // Unterseiten von „Mehr“ mit unterer Leiste tragen den Zurück-Pfeil wie die übrigen
    // Mehr-Unterseiten; er führt auf „Mehr“, auch wenn die Seite nicht von dort kam.
    val mehrUnterseite = currentDest != null && currentDest.istEinesVon(MEHR) && !currentDest.hasRoute<Screen.Mehr>()
    fun zurueckZuMehr() {
        if (!navController.popBackStack(Screen.Mehr, inclusive = false)) navController.zuReiter(Screen.Mehr)
    }

    // Leiste unten und Seitenleiste teilen sich diesen Weg, damit beide die
    // Rollposition gleich behandeln.
    fun reiterWaehlen(screen: Screen) {
        onTabAngetippt(screen)
        if (navController.currentBackStackEntry?.destination?.hasRoute<Screen.Monitoring>() == true) {
            navController.popBackStack()
        }
        navController.zuReiter(screen)
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
    // Passt eine Beschriftung auch in Normalgrösse nicht, stehen nur Symbole da (Name für
    // TalkBack); das gewählte Ziel nennt der Titel oben.
    val beschriftet = remember(LocalDensity.current.fontScale) { mutableStateOf(true) }
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
                        icon = { ReiterSymbol(label, beschriftet.value) { Symbol(screen, icon) } },
                        label = if (beschriftet.value) ({ ReiterBeschriftung(label, reiterSchrift, beschriftet) }) else null,
                    )
                }
            }
        }
        Scaffold(
            modifier = Modifier.weight(1f).nestedScroll(einklappen.nestedScrollConnection),
            topBar = {
              Column {
                TopAppBar(
                    // Reiner Text wie jeder Material-Titel: Ein Symbol davor las sich bei
                    // „Mehr“ als Menüknopf. Vorleseprogramme springen zur Überschrift.
                    title = { Text(title, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) },
                    navigationIcon = {
                        if (mehrUnterseite) ch.brickinventoryapp.ui.components.MitTooltip(stringResource(R.string.common_back)) {
                            IconButton(onClick = { zurueckZuMehr() }) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.common_back))
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = akzent.leiste,
                        titleContentColor = akzent.aufLeiste,
                        navigationIconContentColor = akzent.aufLeiste,
                        actionIconContentColor = akzent.aufLeiste,
                        scrolledContainerColor = akzent.leiste,
                    ),
                    scrollBehavior = einklappen,
                )
                if (art == Navigationsart.LEISTE_UNTEN && currentDest?.istEinesVon(SAMMLUNG) == true) {
                    SammlungUmschalter(sammlungsZiel(currentDest), onWahl = { ziel ->
                        onTabAngetippt(ziel)
                        navController.zuReiter(ziel)
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
                                icon = { ReiterSymbol(label, beschriftet.value) { Symbol(screen, icon) } },
                                label = if (beschriftet.value) ({ ReiterBeschriftung(label, reiterSchrift, beschriftet) }) else null,
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
                    if (art == Navigationsart.SEITENLEISTE && currentDest?.istEinesVon(SAMMLUNG + Screen.SetDetail::class) == true) {
                        SammlungUmschalter(sammlungsZiel(currentDest),
                            onWahl = { ziel ->
                                onTabAngetippt(ziel)
                                navController.zuReiter(ziel)
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
    umgebung: ch.brickinventoryapp.nav.ZielUmgebung,
    content: @Composable () -> Unit
) {
    val vm: AppViewModel = aktivitaetsViewModel()
    val state by vm.state.collectAsStateWithLifecycle()
    val selbstUpdate: UpdateViewModel = aktivitaetsViewModel()
    val updateZustand by selbstUpdate.updateState.collectAsStateWithLifecycle()
    val offen by vm.offeneAenderungen.collectAsStateWithLifecycle()
    MainScaffold(
        title = titel,
        navController = umgebung.navController,
        bottomNavItems = umgebung.reiter,
        snackbarHostState = umgebung.snackbarHostState,
        csvImportState = vm.csvImportState,
        onCsvAbbrechen = { vm.cancelCsvImport() },
        // Reiter angetippt → oben anfangen.
        onTabAngetippt = { ziel -> vm.scrollMemory.vergissReiter(ziel.rollSchluessel) },
        serverUrl = state.serverUrl,
        // Der stille Start-Test hat ein Ergebnis — hier bekommt es einen Ort.
        updateVerfuegbar = updateZustand.neuereFassung != null,
        offeneAenderungen = offen,
        content = content
    )
}

/**
 * Beschriftung eines Ziels in Leiste und Seitenleiste: immer eine Zeile, alle in einer
 * Grösse. Reicht die Breite nicht, wird die Schrift kleiner, aber nie kleiner als ohne
 * Vergrösserung — sonst hebt die Leiste die Systemeinstellung auf. Passt sie dann noch
 * nicht, fällt die Beschriftung weg ([beschriftet]).
 */
@Composable
private fun ReiterBeschriftung(text: String, groesse: MutableState<TextUnit>, beschriftet: MutableState<Boolean>) {
    val stil = MaterialTheme.typography.labelSmall
    val boden = stil.fontSize / LocalDensity.current.fontScale.coerceAtLeast(1f)
    val aktuell = if (groesse.value.isSpecified) groesse.value else stil.fontSize
    Text(
        text, style = stil.copy(fontSize = aktuell), maxLines = 1, softWrap = false,
        overflow = TextOverflow.Clip,
        onTextLayout = { l ->
            if (l.hasVisualOverflow) {
                if (aktuell.value - REITER_SCHRIFT_SCHRITT >= boden.value) groesse.value = (aktuell.value - REITER_SCHRIFT_SCHRITT).sp
                else beschriftet.value = false
            }
        },
    )
}

/** Ohne Beschriftung trägt das Symbol den Namen des Ziels. */
@Composable
private fun ReiterSymbol(name: String, beschriftet: Boolean, symbol: @Composable () -> Unit) {
    if (beschriftet) symbol() else Box(Modifier.semantics { contentDescription = name }) { symbol() }
}

/** Unbestimmt: Die Beschriftung beginnt bei der Grösse des Themas. */
private val REITER_SCHRIFT_START = TextUnit.Unspecified

/** Um so viel Punkt schrumpft die gemeinsame Grösse je Messung mit Überstand. */
private const val REITER_SCHRIFT_SCHRITT = 0.5f

/** Die Ziele des Umschalters Sets | Teile | Minifiguren, in seiner Reihenfolge. */
internal val SAMMLUNGS_ZIELE: List<Screen> = listOf(Screen.Gallery, Screen.Parts, Screen.Minifigs)

/** Sets, Teile und Minifiguren teilen sich in der Leiste EIN Ziel. */
private val SAMMLUNG: Set<KClass<out Screen>> = SAMMLUNGS_ZIELE.map { it::class }.toSet()

/** Seiten mit unterer Leiste, die man über „Mehr“ erreicht — dort bleibt „Mehr“ gewählt. */
private val MEHR: Set<KClass<out Screen>> = setOf(Screen.Mehr::class, Screen.PartsList::class,
    Screen.Comparison::class, Screen.Settings::class, Screen.Monitoring::class)

/** Die Ziele, bei denen ein Ziel der Leiste als gewählt gilt. */
private fun zieleVon(screen: Screen): Set<KClass<out Screen>> = when (screen) {
    Screen.Gallery -> SAMMLUNG + Screen.SetDetail::class
    Screen.Mehr -> MEHR
    else -> setOf(screen::class)
}

private fun NavDestination.istEinesVon(ziele: Set<KClass<out Screen>>) = ziele.any { hasRoute(it) }

/** Welcher Teil der Sammlung offen ist; neben einem Set-Detail bleibt „Sets“ gewählt. */
private fun sammlungsZiel(ziel: NavDestination): Screen =
    SAMMLUNGS_ZIELE.firstOrNull { ziel.hasRoute(it::class) } ?: Screen.Gallery

/** Wie ein Reiter: Zustand der anderen sichern, nicht doppelt stapeln. */
private fun androidx.navigation.NavController.zuReiter(ziel: Screen) =
    navigate(ziel) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

/**
 * Sets | Teile | Minifiguren — derselbe Umschalter wie oben in der Webapp. Über
 * SegmentWahl, damit er bei grosser Schrift wie jede Einfachwahl zu Chips wird.
 */
@Composable
private fun SammlungUmschalter(aktuell: Screen, onWahl: (Screen) -> Unit, modifier: Modifier = Modifier) {
    val texte = listOf(R.string.gallery_stat_sets, R.string.nav_parts, R.string.nav_minifigs)
    val ziele = SAMMLUNGS_ZIELE.zip(texte).map { (ziel, text) -> ziel to stringResource(text) }
    ch.brickinventoryapp.ui.components.SegmentWahl<Screen?>(
        optionen = ziele,
        gewaehlt = aktuell,
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
