package ch.brickinventoryapp.app

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.components.fokusRahmen
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
import ch.brickinventoryapp.ui.theme.ReiterFarben
import ch.brickinventoryapp.ui.theme.reiterFarben
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.konto.ui.KontoZiel
import ch.brickinventoryapp.sammlung.ui.SammlungZiel
import ch.brickinventoryapp.teile.ui.TeileZiel
import ch.brickinventoryapp.ui.Navigationsart
import ch.brickinventoryapp.ui.Reiterziel
import ch.brickinventoryapp.ui.navigationsart
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.ui.vergissReiter
import ch.brickinventoryapp.verwaltung.ui.VerwaltungZiel
import ch.brickinventoryapp.app.nav.Reiter
import ch.brickinventoryapp.app.nav.ZielUmgebung
import ch.brickinventoryapp.ui.components.AusgangLeiste
import ch.brickinventoryapp.ui.components.LocalOffeneAenderungen
import ch.brickinventoryapp.ui.components.LocalOfflineHinweise
import ch.brickinventoryapp.ui.components.LocalSnackbarPlatz
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.AnsichtUmschalter
import ch.brickinventoryapp.ui.components.UpdatePunkt
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.LocalAkzentflaechen
import ch.brickinventoryapp.app.ui.components.CsvImportBanner
import ch.brickinventoryapp.app.csv.CsvImportUiState
import ch.brickinventoryapp.app.nav.AppZiel

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
    val akzent = LocalAkzentflaechen.current
    // Die App-Leiste weicht beim Rollen nach unten und kommt beim Zurückrollen wieder:
    // Auf dem Telefon standen sonst Titel und Umschalter dauerhaft über dem Inhalt.
    // Ein neues Ziel beginnt mit sichtbarer Leiste.
    val einklappen = TopAppBarDefaults.enterAlwaysScrollBehavior()
    LaunchedEffect(currentDest?.id) { einklappen.state.heightOffset = 0f }

    fun istGewaehlt(screen: Any) =
        currentDest?.hierarchy?.any { d -> d.istEinesVon(zieleVon(screen)) } == true

    // Unterseiten von „Mehr“ mit unterer Leiste tragen den Zurück-Pfeil wie die übrigen
    // Mehr-Unterseiten. Er geht denselben Weg wie die Zurück-Geste: Führten beide an
    // verschiedene Orte, wüsste man vor dem Tippen nicht, wo man landet. Nur ohne
    // vorigen Eintrag (Einstieg von aussen) führt er auf „Mehr“.
    val mehrUnterseite = currentDest != null && currentDest.istEinesVon(MEHR) && !currentDest.hasRoute<AppZiel.Mehr>()
    fun zurueckAusMehr() {
        if (navController.previousBackStackEntry != null && navController.popBackStack()) return
        if (!navController.popBackStack(AppZiel.Mehr, inclusive = false)) navController.zuReiter(AppZiel.Mehr)
    }

    // Leiste unten und Seitenleiste teilen sich diesen Weg, damit beide die
    // Rollposition gleich behandeln.
    fun reiterWaehlen(screen: Any) {
        onTabAngetippt(screen)
        if (navController.currentBackStackEntry?.destination?.hasRoute<VerwaltungZiel.Monitoring>() == true) {
            navController.popBackStack()
        }
        navController.zuReiter(screen)
    }

    // Das Symbol eines Ziels, an „Mehr“ mit dem Punkt für eine neue Version.
    @Composable
    fun Symbol(screen: Any, icon: @Composable () -> Unit) {
        if (screen == AppZiel.Mehr && updateVerfuegbar) BadgedBox(badge = { UpdatePunkt() }) { icon() } else icon()
    }

    // Die Fensterbreite entscheidet, nicht das Gerät: Ein Tablet im geteilten
    // Bildschirm ist schmal und bekommt die Leiste unten.
    // Die Snackbar liegt über dem Inhalt; ihre Höhe hebt den Erfassen-Knopf darüber.
    var snackbarHoehe by remember { mutableIntStateOf(0) }
    val offlineHinweise = remember { mutableIntStateOf(0) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val art = navigationsart(maxWidth.value)
        // Auf breiten Fenstern steht die Seitenleiste über die volle Höhe links, App-Leiste
        // und Inhalt rechts daneben — dieselben Ziele wie unten, „Mehr“ eingeschlossen.
        Row(Modifier.fillMaxSize()) {
        if (art == Navigationsart.SEITENLEISTE) {
            ReiterSeitenleiste(bottomNavItems, ::istGewaehlt, ::reiterWaehlen) { screen, icon -> Symbol(screen, icon) }
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
                        if (mehrUnterseite) MitTooltip(stringResource(R.string.common_back)) {
                            IconButton(onClick = { zurueckAusMehr() }) {
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
                    ReiterLeiste(bottomNavItems, ::istGewaehlt, ::reiterWaehlen) { screen, icon -> Symbol(screen, icon) }
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
                    if (art == Navigationsart.SEITENLEISTE && currentDest?.istEinesVon(SAMMLUNG + SammlungZiel.SetDetail::class) == true) {
                        SammlungUmschalter(sammlungsZiel(currentDest),
                            onWahl = { ziel ->
                                onTabAngetippt(ziel)
                                navController.zuReiter(ziel)
                            })
                    }
                    // Steht ein Offline-Hinweis, nennt er die wartenden Änderungen selbst.
                    if (offlineHinweise.intValue == 0) AusgangLeiste(offeneAenderungen)
                    if (csvImport.running) {
                        CsvImportBanner(
                            done = csvImport.done, total = csvImport.total, current = csvImport.current,
                            ok = csvImport.ok, warn = csvImport.warn, err = csvImport.err, running = csvImport.running,
                            onAbbrechen = onCsvAbbrechen,
                        )
                    }
                    Box(Modifier.fillMaxSize()) {
                        CompositionLocalProvider(
                            LocalSnackbarPlatz provides
                                with(LocalDensity.current) { snackbarHoehe.toDp() },
                            LocalOffeneAenderungen provides offeneAenderungen,
                            LocalOfflineHinweise provides offlineHinweise,
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
    umgebung: ZielUmgebung,
    content: @Composable () -> Unit
) {
    val vm = umgebung.aktivitaet.app
    val selbstUpdate = umgebung.aktivitaet.update
    val updateZustand by selbstUpdate.updateState.collectAsStateWithLifecycle()
    val offen by vm.offeneAenderungen.collectAsStateWithLifecycle()
    val csvImport = umgebung.aktivitaet.csvImport
    MainScaffold(
        title = titel,
        navController = umgebung.navController,
        bottomNavItems = umgebung.reiter,
        snackbarHostState = umgebung.snackbar,
        csvImportState = csvImport.csvImportState,
        onCsvAbbrechen = { csvImport.cancelCsvImport() },
        // Reiter angetippt → oben anfangen.
        onTabAngetippt = { ziel -> vm.scrollMemory.vergissReiter(rollSchluessel(ziel)) },
        // Der stille Start-Test hat ein Ergebnis — hier bekommt es einen Ort.
        updateVerfuegbar = updateZustand.neuereFassung != null,
        offeneAenderungen = offen,
        content = content
    )
}

/** Ein Ziel der Navigation: Symbol mit Anzeige, darunter die Beschriftung oder (ohne [groesse]) nur ihr Name. */
@Composable
private fun ReiterZiel(
    gewaehlt: Boolean, name: String, groesse: TextUnit?, farben: ReiterFarben,
    onClick: () -> Unit, modifier: Modifier = Modifier, symbol: @Composable () -> Unit,
) {
    Column(
        modifier.fokusRahmen(Formen.kachel).selectable(selected = gewaehlt, onClick = onClick, role = Role.Tab)
            .then(if (groesse == null) Modifier.semantics { contentDescription = name } else Modifier)
            .padding(horizontal = Abstaende.winzig, vertical = Abstaende.mittel),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.winzig),
    ) {
        Box(
            Modifier.size(width = ANZEIGE_BREITE, height = ANZEIGE_HOEHE)
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
private fun ReiterLeiste(
    ziele: List<Reiter>,
    gewaehlt: (Any) -> Boolean, onWahl: (Any) -> Unit,
    symbol: @Composable (Any, @Composable () -> Unit) -> Unit,
) {
    val farben = reiterFarben(MaterialTheme.colorScheme)
    val stil = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold)
    val messer = rememberTextMeasurer()
    val dichte = LocalDensity.current
    Surface(color = farben.leiste) {
        BoxWithConstraints(Modifier.fillMaxWidth().windowInsetsPadding(NavigationBarDefaults.windowInsets)) {
            val satz = with(dichte) {
                reiterSatz(ziele.map { messer.measure(it.beschriftung, stil).size.width.toFloat() },
                    ziele.indexOfFirst { gewaehlt(it.ziel) }, maxWidth.toPx(), (Abstaende.winzig * 2).toPx(),
                    ANZEIGE_MIN.toPx(), fontScale)
            }
            Row(Modifier.fillMaxWidth().heightIn(min = LEISTE_HOEHE).selectableGroup(), verticalAlignment = Alignment.CenterVertically) {
                ziele.forEachIndexed { i, (screen, icon, name) ->
                    val beschriftet = satz.alle || i == satz.gewaehlt
                    val platz = Modifier.weight(if (i == satz.gewaehlt) satz.gewicht else 1f)
                    val ziel: @Composable (Modifier) -> Unit = { m ->
                        ReiterZiel(gewaehlt(screen), name, if (beschriftet) stil.fontSize * satz.faktor else null, farben,
                            { onWahl(screen) }, m) { symbol(screen, icon) }
                    }
                    if (beschriftet) ziel(platz) else MitTooltip(name, platz) { ziel(Modifier.fillMaxWidth()) }
                }
            }
        }
    }
}

/** Die Seitenleiste wird so breit, wie die längste Beschriftung in voller Grösse braucht. */
@Composable
private fun ReiterSeitenleiste(
    ziele: List<Reiter>,
    gewaehlt: (Any) -> Boolean, onWahl: (Any) -> Unit,
    symbol: @Composable (Any, @Composable () -> Unit) -> Unit,
) {
    val farben = reiterFarben(MaterialTheme.colorScheme)
    val groesse = MaterialTheme.typography.labelMedium.fontSize
    Surface(color = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier.fillMaxHeight().width(IntrinsicSize.Max).widthIn(min = SEITENLEISTE_BREITE)
                .windowInsetsPadding(NavigationRailDefaults.windowInsets).padding(top = Abstaende.mittel).selectableGroup(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ziele.forEach { (screen, icon, name) ->
                ReiterZiel(gewaehlt(screen), name, groesse, farben, { onWahl(screen) }, Modifier.fillMaxWidth()) { symbol(screen, icon) }
            }
        }
    }
}

/** Wie die Leiste unten beschriftet ist: alle mit [faktor] der vollen Grösse, oder nur [gewaehlt] mit [gewicht]. */
internal data class ReiterSatz(val alle: Boolean, val faktor: Float, val gewaehlt: Int, val gewicht: Float)

/**
 * Aus den Breiten der Beschriftungen in voller Grösse ([breiten], px, ohne [rand]) und der
 * Schriftskala [schrift]: ob alle passen, wie weit sie schrumpfen, sonst wie breit das gewählte Ziel wird.
 */
internal fun reiterSatz(breiten: List<Float>, gewaehlt: Int, gesamt: Float, rand: Float, minZiel: Float, schrift: Float): ReiterSatz {
    val anteil = gesamt / breiten.size - rand
    val boden = minOf(schrift, REITER_MIN_SKALA) / schrift
    val faktor = minOf(1f, anteil / (breiten.maxOrNull() ?: 1f))
    if (faktor >= boden || gewaehlt < 0 || breiten.size < 2) return ReiterSatz(true, maxOf(faktor, boden), gewaehlt, 1f)
    val noetig = breiten[gewaehlt] + rand
    val rest = (gesamt - noetig) / (breiten.size - 1)
    if (rest >= minZiel) return ReiterSatz(false, 1f, gewaehlt, noetig / rest)
    val frei = gesamt - minZiel * (breiten.size - 1)
    return ReiterSatz(false, ((frei - rand) / breiten[gewaehlt]).coerceIn(boden, 1f), gewaehlt, frei / minZiel)
}

/** Kleiner als das Anderthalbfache der Normalgrösse wird keine Beschriftung (WCAG 1.4.4). */
private const val REITER_MIN_SKALA = 1.5f
private val ANZEIGE_BREITE = 56.dp
private val ANZEIGE_HOEHE = 32.dp
/** Breite eines unbeschrifteten Ziels: Anzeige und Rand. */
private val ANZEIGE_MIN = 64.dp
private val LEISTE_HOEHE = 80.dp
private val SEITENLEISTE_BREITE = 80.dp

/** Der Schlüssel der gemerkten Rollposition; Ziele ohne Liste haben keinen eigenen. */
internal fun rollSchluessel(ziel: Any): String = (ziel as? Reiterziel)?.rollSchluessel ?: ziel.toString()

/** Die Ziele des Umschalters Sets | Teile | Minifiguren, in seiner Reihenfolge. */
internal val SAMMLUNGS_ZIELE: List<Any> = listOf(SammlungZiel.Gallery, TeileZiel.Parts, TeileZiel.Minifigs)

/** Sets, Teile und Minifiguren teilen sich in der Leiste EIN Ziel. */
private val SAMMLUNG: Set<KClass<out Any>> = SAMMLUNGS_ZIELE.map { it::class }.toSet()

/** Seiten mit unterer Leiste, die man über „Mehr“ erreicht — dort bleibt „Mehr“ gewählt. */
private val MEHR: Set<KClass<out Any>> = setOf(AppZiel.Mehr::class, TeileZiel.PartsList::class,
    SammlungZiel.Comparison::class, KontoZiel.Settings::class, VerwaltungZiel.Monitoring::class)

/** Die Ziele, bei denen ein Ziel der Leiste als gewählt gilt. */
private fun zieleVon(screen: Any): Set<KClass<out Any>> = when (screen) {
    SammlungZiel.Gallery -> SAMMLUNG + SammlungZiel.SetDetail::class
    AppZiel.Mehr -> MEHR
    else -> setOf(screen::class)
}

private fun NavDestination.istEinesVon(ziele: Set<KClass<out Any>>) = ziele.any { hasRoute(it) }

/** Welcher Teil der Sammlung offen ist; neben einem Set-Detail bleibt „Sets“ gewählt. */
private fun sammlungsZiel(ziel: NavDestination): Any =
    SAMMLUNGS_ZIELE.firstOrNull { ziel.hasRoute(it::class) } ?: SammlungZiel.Gallery

/** Wie ein Reiter: Zustand der anderen sichern, nicht doppelt stapeln. */
private fun androidx.navigation.NavController.zuReiter(ziel: Any) =
    navigate(ziel) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

/**
 * Sets | Teile | Minifiguren — derselbe Umschalter wie oben in der Webapp. Ein Wechsel
 * der Ansicht, darum Segmente, auch bei 200 % Schrift (dann seitlich rollbar).
 */
@Composable
private fun SammlungUmschalter(aktuell: Any, onWahl: (Any) -> Unit, modifier: Modifier = Modifier) {
    val texte = listOf(R.string.nav_sets, R.string.nav_parts, R.string.nav_minifigs)
    val ziele = SAMMLUNGS_ZIELE.zip(texte).map { (ziel, text) -> ziel to stringResource(text) }
    AnsichtUmschalter<Any?>(
        optionen = ziele,
        gewaehlt = aktuell,
        onWahl = { if (it != null) onWahl(it) },
        modifier = modifier.padding(horizontal = Abstaende.mittel,
            vertical = Abstaende.winzig),
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
