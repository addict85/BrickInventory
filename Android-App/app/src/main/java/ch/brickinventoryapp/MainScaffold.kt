package ch.brickinventoryapp

import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.CompareArrows
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.screens.*
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel
import ch.brickinventoryapp.ui.viewmodel.UpdateViewModel

/**
 * Gemeinsames Gerüst aller eingeloggten Screens: obere Leiste mit Titel und
 * Reiter-Icon, untere Navigationsleiste, Snackbar und der CSV-Import-Balken.
 *
 * Aus AppNavigation.kt herausgelöst (Punkt 9 der Optimierungsliste). Der
 * Schnitt ist bewusst hier gesetzt: MainScaffold bekommt alles über seine
 * Parameterliste und greift auf nichts aus dem umgebenden Composable zu — die
 * Verschiebung kann daher nichts kaputtmachen.
 *
 * Der grössere Teil, die Aufteilung des NavHost in Teilgraphen, steht noch aus.
 * Dort schliesst jeder composable-Block über zahlreiche lokale Werte
 * (state, vm, navController, imageLoader, activity …); jeder herausgelöste
 * Teilgraph braucht sie als Parameter, und ein vergessener ist ein
 * Compilerfehler. Das gehört in eine Runde mit laufendem Gradle-Build.
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
     * Laufenden CSV-Import abbrechen — der Knopf im Fortschrittsbalken.
     *
     * Als Rueckruf und nicht ueber ein ViewModel: Dieses Geruest bekommt
     * Zustand und Rueckrufe, sonst nichts. Mein erster Entwurf schrieb
     * `vm.cancelCsvImport()` direkt in den Rumpf — die Datei hat gar kein `vm`,
     * und der Uebersetzer hat es sofort gesagt (Lauf 108).
     */
    onCsvAbbrechen: () -> Unit,
    onLogout: () -> Unit,
    @Suppress("UNUSED_PARAMETER") serverUrl: String,
    isAdmin: Boolean = false,
    /**
     * Liegt eine neuere Fassung bereit?
     *
     * ── Warum es diesen Parameter braucht ────────────────────────────────────
     *
     * Marcos Befund: „obwohl der Bau durch ist erhalte ich beim Starten der
     * Android-App keine Update-Meldung."
     *
     * Die Pruefung LIEF — AppNavigation.kt stoesst sie beim Start an
     * (`pruefeAufUpdate(still = true)`), und der Kommentar dort sagt sogar
     * ausdruecklich: „Hier und nicht im Einstellungs-Bildschirm: Die Frage
     * ‚gibt es etwas Neueres?' gilt der ganzen App."
     *
     * Die ANTWORT gilt seither aber nur dem Einstellungs-Bildschirm: `updateState`
     * wurde im ganzen Hauptbaum an genau einer Stelle gelesen, in
     * SettingsScreen.kt. Die Pruefung fand also etwas, legte es ins ViewModel —
     * und niemand zeichnete es. Der Weg wurde app-weit gemacht, die Anzeige
     * nicht mitgenommen.
     *
     * Ein Punkt am Konto-Symbol und am Menuepunkt. Er stand hier zuerst
     * ALLEIN, mit der Begruendung, ein Dialog beim Start waere das Gegenteil
     * von „beim Start still pruefen, nie von allein laden".
     *
     * Diese Begruendung war zur Haelfte falsch, und Marco hat es gemeldet:
     * „Aktuell wird nur eine Kugel in den Einstellungen angezeigt was oft
     * übersehen wird." Der Punkt erfuellte das Nicht-Draengen und verfehlte
     * das Bemerktwerden — und bemerkt zu werden war der ganze Zweck.
     *
     * Seither fragt zusaetzlich ein Dialog beim Start
     * (ui/dialogs/UpdateDialog.kt). Die alte Vorgabe gilt weiter, wo sie
     * gemeint war: GELADEN wird nach wie vor nie von allein, sondern erst auf
     * „Jetzt aktualisieren".
     *
     * Der Punkt bleibt trotzdem, und zwar nicht aus Gewohnheit: Wer im Dialog
     * „Spaeter" waehlt, soll den Befund weiterhin sehen koennen — und den Weg
     * dorthin, wo der Knopf steht.
     */
    updateVerfuegbar: Boolean = false,
    /**
     * Ein Reiter wurde unten angetippt — seine gemerkte Rollposition verwerfen.
     *
     * ── Marcos Vorgabe (Nachtrag 114) ────────────────────────────────────────
     * „Im Reiter Teile muss ich beim Öffnen nach oben scrollen, damit die
     * manuell erfassten Teile angezeigt werden. Wenn der Reiter geöffnet wird,
     * soll die Seite direkt die manuell erfassten Teile anzeigen."
     *
     * Der Scroll-Merker (Nachträge 92 bis 95) ist dafür da, dass die Liste beim
     * ZURÜCKKEHREN aus einer Detailansicht wieder an derselben Stelle steht. Er
     * griff bisher auch, wenn der Reiter unten neu angetippt wurde — dann
     * öffnete sich der Reiter irgendwo in der Mitte, und die manuell erfassten
     * Einträge ganz oben waren nicht zu sehen.
     *
     * Das sind zwei verschiedene Absichten: „ich komme zurück" behält die
     * Stelle, „ich gehe auf diesen Reiter" fängt oben an. Unterschieden wird
     * genau hier, wo der Unterschied bekannt ist — im Bildschirm selbst ist
     * beides nicht auseinanderzuhalten.
     *
     * OHNE Vorgabewert, und das ist der Punkt: Vergisst eine künftige
     * Einbindung den Rückruf, hinge es davon ab, über welchen Reiter man kommt
     * — von der Galerie aus oben, vom Katalog aus in der Mitte. Mit `= {}` hätte
     * das nur der Regex-Test in TabOpensAtTopTest gemeldet; ohne meldet es der
     * Compiler. Dieselbe Überlegung wie beim Server: die Regel gehört an die
     * Stelle, die sie erzwingen kann, nicht an die, die sie beobachtet.
     */
    onTabAngetippt: (Screen) -> Unit,
    content: @Composable () -> Unit
) {
    var showLogoutMenu by remember { mutableStateOf(false) }
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDest = navBackStackEntry?.destination
    val isBrick = LocalIsBrickTheme.current

    fun istGewaehlt(screen: Screen) =
        currentDest?.hierarchy?.any { d -> d.route?.let { it in zieleVon(screen) } == true } == true

    // Leiste unten und Seitenleiste teilen sich diesen Weg, damit beide die
    // Rollposition gleich behandeln (Nachtrag 114).
    fun reiterWaehlen(screen: Screen) {
        onTabAngetippt(screen)
        if (navController.currentBackStackEntry?.destination?.route == Screen.Monitoring.route) {
            navController.popBackStack()
        }
        navController.zuReiter(screen.route)
    }

    // Die Fensterbreite entscheidet, nicht das Gerät: Ein Tablet im geteilten
    // Bildschirm ist schmal und bekommt die Leiste unten.
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val art = navigationsart(maxWidth.value)
        Scaffold(
            topBar = {
              Column {
                TopAppBar(
                    title = {
                        // Der Seitentitel ist die Überschrift der Ansicht — Vorleseprogramme springen dorthin.
                        Row(Modifier.semantics(mergeDescendants = true) { heading() },
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            // Icon des aktuell gewählten Tabs links vom Namen anzeigen —
                            // dasselbe Icon wie in der unteren Navigationsleiste, damit
                            // oben und unten konsistent sind. Das frühere feste App-Logo
                            // entfällt, damit oben links nur noch das Reiter-Icon steht.
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
                        containerColor = if (isBrick) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                        titleContentColor = if (isBrick) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                        actionIconContentColor = if (isBrick) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
                    ),
                    actions = {
                        IconButton(onClick = { showLogoutMenu = true }) {
                            BadgedBox(badge = { if (updateVerfuegbar) Badge() }) {
                                Icon(Icons.Default.AccountCircle, stringResource(R.string.main_account), tint = if (isBrick) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.primary)
                            }
                        }
                        DropdownMenu(showLogoutMenu, { showLogoutMenu = false }) {
                            // ── Der Weg zu den Einstellungen ──────────────────────
                            //
                            // Marcos Befund: „wo finde ich die Einstellungen in der
                            // Android-App?" — Antwort war: nirgends. Der Bildschirm
                            // stand seit dem ersten Commit im Navigationsgraphen
                            // (nav/ToolsGraph.kt), aber NIEMAND navigierte dorthin:
                            // `Screen.Settings` kam im ganzen Hauptbaum genau einmal
                            // vor, naemlich in seiner eigenen Registrierung.
                            //
                            // Unerreichbar waren damit Waehrung, Standard-Zustand,
                            // Preis-Zustand, Sprache, Haushalt, Konto, CSV-Import,
                            // angemeldete Geraete UND die Update-Pruefung.
                            //
                            // HIER und nicht als Reiter unten: Die Reiter zeigen
                            // BESTAENDE. Einstellungen sind
                            // keine Bestandsansicht, und die Webapp fuehrt sie
                            // ebenfalls nicht in der Hauptnavigation. Das
                            // Konto-Menue ist der Ort fuer alles, was kein Reiter
                            // ist — die Ueberwachung steht schon hier.
                            //
                            // Der Text ist R.string.nav_settings, derselbe wie die
                            // Ueberschrift des Bildschirms: Ein zweiter Schluessel
                            // mit demselben Wort waere eine Stelle, an der Menue
                            // und Ziel auseinanderlaufen koennen.
                            // ── Die sechs Rubriken stehen HIER, nicht eine Ebene tiefer ──
                            //
                            // Marcos Vorgabe vom 17.10.: „in der Android-App sollten
                            // die Punkte unter Einstellungen eine ebene nach aussen
                            // wandern wo heute Einstellungen und Abmelden und
                            // Monitoring zu finden sind."
                            //
                            // Bis dahin lagen sie als Liste IM Einstellungs-
                            // bildschirm: Konto-Menue, Einstellungen, Liste,
                            // Unterseite — drei Tipper bis zu den Gutscheinen.
                            // Jetzt sind es zwei, und die Klappe liest sich wie das
                            // Menue der Webapp hinter dem Benutzernamen: erst die
                            // Seiten, dann die Einstellungen, dann die Handlung.
                            //
                            // Die Reihenfolge ist NICHT alphabetisch, sondern nach
                            // Haeufigkeit — sie kommt unveraendert aus der Liste
                            // mit: Gutscheine werden im Laden gebraucht (Marcos
                            // „moeglichst einfach erreichbar"), Preisalarme beim
                            // Stoebern, der Rest selten. GutscheineContractTest
                            // haelt fest, dass die Gutscheine erster Eintrag
                            // bleiben.
                            //
                            // Jede Route steht AUSGESCHRIEBEN da und wird nicht
                            // zusammengesetzt: ErreichbareRoutenTest sucht nach
                            // `navigate(Screen.X.route)`, und ein Bildschirm, zu
                            // dem nur ein gebauter String fuehrt, waere fuer die
                            // Pruefung unerreichbar — also genau das, was sie
                            // finden soll.
                            MenuZiel(R.string.vouchers_title, Icons.Default.Redeem) {
                                showLogoutMenu = false
                                navController.navigate(Screen.Gutscheine.route)
                            }
                            MenuZiel(R.string.alerts_group, Icons.Default.NotificationsActive) {
                                showLogoutMenu = false
                                navController.navigate(Screen.Preisalarme.route)
                            }
                            // Der Preisvergleich war der sechste Reiter; Material sieht
                            // unten höchstens fünf vor, und die Webapp führt ihn nicht.
                            // Neben den Preisalarmen, weil beide beim Stöbern helfen.
                            MenuZiel(R.string.nav_comparison, Icons.AutoMirrored.Filled.CompareArrows) {
                                showLogoutMenu = false
                                navController.navigate(Screen.Comparison.route)
                            }
                            MenuZiel(R.string.storage_manage, Icons.Default.Inventory2) {
                                showLogoutMenu = false
                                navController.navigate(Screen.Lagerorte.route)
                            }
                            MenuZiel(R.string.household_title, Icons.Default.Group) {
                                showLogoutMenu = false
                                navController.navigate(Screen.Haushalt.route)
                            }
                            MenuZiel(R.string.csv_upload_title, Icons.Default.UploadFile) {
                                showLogoutMenu = false
                                navController.navigate(Screen.CsvImport.route)
                            }
                            MenuZiel(R.string.konto_title, Icons.Default.AccountCircle) {
                                showLogoutMenu = false
                                navController.navigate(Screen.Konto.route)
                            }
                            // Ein Strich zwischen den Rubriken und dem, was in den
                            // Einstellungen uebrig bleibt: Anzeige & Preise,
                            // Server, Update.
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.nav_settings)) },
                                onClick = {
                                    showLogoutMenu = false
                                    navController.navigate(Screen.Settings.route) {
                                        popUpTo(navController.graph.findStartDestination().id) {
                                            saveState = true
                                        }
                                        launchSingleTop = true
                                        restoreState = false
                                    }
                                },
                                leadingIcon = { Icon(Icons.Default.Settings, null) },
                                // Der Punkt wiederholt sich hier: Wer das Menue
                                // oeffnet, sieht das Symbol darueber nicht mehr.
                                trailingIcon = { if (updateVerfuegbar) Badge() },
                            )
                            if (isAdmin) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.main_menu_monitoring)) },
                                    onClick = {
                                        showLogoutMenu = false
                                        navController.navigate(Screen.Monitoring.route) {
                                            popUpTo(navController.graph.findStartDestination().id) {
                                                saveState = true
                                            }
                                            launchSingleTop = true
                                            restoreState = false
                                        }
                                    },
                                    leadingIcon = { Icon(Icons.Default.Assessment, null) }
                                )
                            }
                            // Der Trenner steht jetzt AUSSERHALB der Verwalter-Bedingung:
                            // Ueber ihm die Wege zu einem Ziel, unter ihm die Handlungen
                            // an der Sitzung. Die obere Gruppe ist nie mehr leer, seit
                            // die Einstellungen darin stehen — vorher haette ein Trenner
                            // ohne Verwalterrechte am Anfang des Menues gestanden.
                            HorizontalDivider()
                            // „Server aendern" ist in die Einstellungen gewandert
                            // (Marcos Wunsch). Es passt dorthin: Der Server ist
                            // eine EINSTELLUNG wie Waehrung und Sprache, keine
                            // Handlung an der laufenden Sitzung. Im Menue bleibt
                            // damit nur, was die Sitzung beendet.
                            DropdownMenuItem(text = { Text(stringResource(R.string.main_menu_logout)) }, onClick = { showLogoutMenu = false; onLogout() },
                                leadingIcon = { Icon(Icons.AutoMirrored.Filled.Logout, null) })
                        }
                    }
                )
                if (currentDest?.route?.let { it in SAMMLUNG } == true) {
                    SammlungUmschalter(currentDest?.route) { ziel ->
                        onTabAngetippt(ziel)
                        navController.zuReiter(ziel.route)
                    }
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
                                icon = icon,
                                label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                                selected = istGewaehlt(screen),
                                onClick = { reiterWaehlen(screen) }
                            )
                        }
                    }
                }
            },
            snackbarHost = { SnackbarHost(snackbarHostState) },
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
        ) { padding ->
            // Globaler CSV-Import-Balken: erscheint auf allen Tabs (wie in der
            // Webapp), sobald ein Import läuft — egal von wo er gestartet wurde.
            val csvImport by csvImportState.collectAsStateWithLifecycle()
            Row(Modifier.fillMaxSize().padding(padding)) {
                if (art == Navigationsart.SEITENLEISTE) {
                    // Die Ränder hat das Scaffold schon abgezogen; eigene Insets
                    // der Seitenleiste rückten sie ein zweites Mal ein.
                    NavigationRail(
                        containerColor = MaterialTheme.colorScheme.surface,
                        windowInsets = WindowInsets(0, 0, 0, 0)
                    ) {
                        bottomNavItems.forEach { (screen, icon, label) ->
                            NavigationRailItem(
                                selected = istGewaehlt(screen),
                                onClick = { reiterWaehlen(screen) },
                                icon = icon,
                                label = { Text(label, style = MaterialTheme.typography.labelSmall) }
                            )
                        }
                    }
                }
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    if (csvImport.running) {
                        CsvImportBanner(
                            done = csvImport.done, total = csvImport.total, current = csvImport.current,
                            ok = csvImport.ok, warn = csvImport.warn, err = csvImport.err, running = csvImport.running,
                            onAbbrechen = onCsvAbbrechen,
                        )
                    }
                    Box(Modifier.fillMaxSize()) { content() }
                }
            }
        }
    }
}

/**
 * Das Gerüst für ein Reiter-Ziel — mit allem, was in JEDEM Ziel gleich ist.
 *
 * ── Warum es das gibt (Nachtrag 120) ─────────────────────────────────────────
 *
 * Die neun `MainScaffold`-Einbindungen in CollectionGraph, ToolsGraph und
 * CatalogGraph waren Zeichen für Zeichen identisch, bis auf den Titel:
 * derselbe Abmelde-Rückruf, dasselbe Verwerfen der Rollposition, dieselbe
 * Weitergabe von `serverUrl` und `isAdmin`.
 *
 * Das ist genau die Form, aus der der Fehler in Nachtrag 114 entstand: Eine
 * Einbindung vergass `onTabAngetippt`, und es hing davon ab, über welchen
 * Reiter man kam — von der Galerie aus fing die Liste oben an, vom Katalog aus
 * in der Mitte. Damals habe ich den Vorgabewert entfernt, damit der Compiler es
 * meldet. Das war die richtige Sofortmassnahme, aber nicht die Ursache: Die
 * fünf Zeilen standen neunmal da, und eine zehnte Einbindung hätte sie wieder
 * abschreiben müssen.
 *
 * Jetzt gibt es sie einmal. Ein neues Reiter-Ziel kann nichts mehr vergessen,
 * weil es nichts mehr weiterzureichen gibt.
 *
 * NICHT hierher gewandert ist `MainScaffold` selbst: Es bleibt für den Fall
 * offen, dass ein Ziel doch einmal abweichen muss — dann nimmt es wieder den
 * langen Weg, und das fällt beim Lesen auf.
 */
@Composable
fun ReiterGeruest(
    titel: String,
    vm: ch.brickinventoryapp.ui.MainViewModel,
    navController: androidx.navigation.NavHostController,
    bottomNavItems: List<Triple<Screen, @Composable () -> Unit, String>>,
    snackbarHostState: SnackbarHostState,
    content: @Composable () -> Unit
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val selbstUpdate: UpdateViewModel = aktivitaetsViewModel()
    val updateZustand by selbstUpdate.updateState.collectAsStateWithLifecycle()
    MainScaffold(
        title = titel,
        navController = navController,
        bottomNavItems = bottomNavItems,
        snackbarHostState = snackbarHostState,
        csvImportState = vm.csvImportState,
        onCsvAbbrechen = { vm.cancelCsvImport() },
        // Reiter angetippt → oben anfangen (Nachtrag 114).
        onTabAngetippt = { ziel -> vm.scrollMemory.vergissReiter(ziel.route) },
        onLogout = {
            vm.logout()
            navController.navigate(Screen.Login.route) { popUpTo(0) { inclusive = true } }
        },
        serverUrl = state.serverUrl,
        isAdmin = state.isAdmin,
        // Der stille Start-Test hat ein Ergebnis — hier bekommt es einen Ort.
        updateVerfuegbar = updateZustand.neuereFassung != null,
        content = content
    )
}

/**
 * Ein Eintrag der Konto-Klappe, der auf eine Seite fuehrt.
 *
 * Sechsmal dasselbe Geruest auszuschreiben hiesse, dass der siebte Eintrag
 * irgendwann anders aussieht — und zwar erst dann, wenn jemand an einem der
 * sechs etwas aendert.
 *
 * Das Zuklappen steht ABSICHTLICH im Aufrufer und nicht hier drin: Die beiden
 * Eintraege darunter (Einstellungen, Monitoring) machen es genauso, und ein
 * Helfer, der es heimlich mit erledigt, waere der Grund dafuer, dass der
 * naechste Eintrag es vergisst.
 */
@Composable
private fun MenuZiel(
    titel: Int,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onKlick: () -> Unit,
) {
    DropdownMenuItem(
        text = { Text(stringResource(titel)) },
        onClick = onKlick,
        leadingIcon = { Icon(icon, null) },
    )
}

/** Sets, Teile und Minifiguren teilen sich in der Leiste EIN Ziel. */
private val SAMMLUNG = setOf(Screen.Gallery.route, Screen.Parts.route, Screen.Minifigs.route)

/** Die Routen, bei denen ein Ziel der Leiste als gewaehlt gilt. */
private fun zieleVon(screen: Screen): Set<String> =
    if (screen == Screen.Gallery) SAMMLUNG else setOf(screen.route)

/** Wie ein Reiter: Zustand der anderen sichern, nicht doppelt stapeln. */
private fun androidx.navigation.NavController.zuReiter(route: String) =
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

/** Sets | Teile | Minifiguren — derselbe Umschalter wie oben in der Webapp. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SammlungUmschalter(aktuell: String?, onWahl: (Screen) -> Unit) {
    val ziele = listOf(
        Screen.Gallery to R.string.gallery_stat_sets,
        Screen.Parts to R.string.nav_parts,
        Screen.Minifigs to R.string.nav_minifigs_short,
    )
    SingleChoiceSegmentedButtonRow(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = ch.brickinventoryapp.ui.theme.Abstaende.mittel, vertical = ch.brickinventoryapp.ui.theme.Abstaende.winzig)
    ) {
        ziele.forEachIndexed { i, (screen, text) ->
            SegmentedButton(
                selected = aktuell == screen.route,
                onClick = { onWahl(screen) },
                shape = SegmentedButtonDefaults.itemShape(index = i, count = ziele.size),
            ) { Text(stringResource(text)) }
        }
    }
}
