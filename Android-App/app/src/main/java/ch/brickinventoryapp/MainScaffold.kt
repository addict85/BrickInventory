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
 * Reiter-Icon, untere Navigation, Snackbar und der CSV-Import-Balken. Es bekommt
 * alles über seine Parameter und greift auf nichts aus dem umgebenden Composable
 * zu.
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
    onLogout: () -> Unit,
    @Suppress("UNUSED_PARAMETER") serverUrl: String,
    isAdmin: Boolean = false,
    /**
     * Liegt eine neuere Fassung bereit? Die Prüfung läuft app-weit beim Start, deshalb
     * zeigt das Gerüst den Befund: als Punkt am Konto-Symbol und am Menüpunkt. Der
     * Dialog beim Start (UpdateDialog) macht ihn bemerkbar; der Punkt bleibt für den,
     * der „Später“ gewählt hat. Geladen wird nie von allein.
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
    var showLogoutMenu by remember { mutableStateOf(false) }
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDest = navBackStackEntry?.destination
    val isBrick = LocalIsBrickTheme.current

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

    // Die Fensterbreite entscheidet, nicht das Gerät: Ein Tablet im geteilten
    // Bildschirm ist schmal und bekommt die Leiste unten.
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val art = navigationsart(maxWidth.value)
        Scaffold(
            topBar = {
              Column {
                TopAppBar(
                    title = {
                        // Der Seitentitel ist die Überschrift der Ansicht — Vorleseprogramme
                        // springen dorthin.
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
                            // ── Die Seiten des Kontos und der Weg zu den Einstellungen ──
                            //
                            // Hier und nicht als Reiter: Die Reiter zeigen Bestände. Die
                            // Reihenfolge folgt der Häufigkeit — Gutscheine braucht man im Laden.
                            // Jede Route steht ausgeschrieben da, weil ErreichbareRoutenTest nach
                            // `navigate(Screen.X.route)` sucht.
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
                            // „Server ändern" steht in den Einstellungen: Der Server ist
                            // eine Einstellung wie Währung und Sprache, keine Handlung an
                            // der laufenden Sitzung. Im Menü bleibt, was sie beendet.
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
                    ch.brickinventoryapp.ui.components.AusgangLeiste(offeneAenderungen)
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
 * Das Gerüst für ein Reiter-Ziel mit allem, was in jedem Ziel gleich ist
 * (Abmelden, Verwerfen der Rollposition, `serverUrl`, `isAdmin`). Ein neues Ziel
 * kann so nichts vergessen, weil es nichts weiterzureichen gibt. MainScaffold
 * selbst bleibt für Ziele, die abweichen müssen.
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
        onLogout = {
            vm.logout()
            navController.navigate(Screen.Login.route) { popUpTo(0) { inclusive = true } }
        },
        serverUrl = state.serverUrl,
        isAdmin = state.isAdmin,
        // Der stille Start-Test hat ein Ergebnis — hier bekommt es einen Ort.
        updateVerfuegbar = updateZustand.neuereFassung != null,
        offeneAenderungen = offen,
        content = content
    )
}

/**
 * Ein Eintrag der Konto-Klappe, der auf eine Seite führt — ein Gerüst, damit kein
 * Eintrag anders aussieht. Das Zuklappen steht im Aufrufer, wie bei den Einträgen
 * darunter.
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
