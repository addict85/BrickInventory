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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import kotlinx.coroutines.launch
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import ch.brickinventoryapp.ressourcen.R
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
        val schublade = rememberDrawerState(DrawerValue.Closed)
        val schubladenScope = rememberCoroutineScope()
        val oeffneSchublade: () -> Unit = { schubladenScope.launch { schublade.open() } }
        // Wischen nur, solange sie offen ist: Am Rand zu wischen kollidierte sonst mit
        // den waagrecht rollenden Reihen (Kennzahlen, Filter).
        ModalNavigationDrawer(
            drawerState = schublade,
            gesturesEnabled = schublade.isOpen,
            drawerContent = {
                MehrSchublade(navController, isAdmin) { schubladenScope.launch { schublade.close() } }
            },
        ) {
        Scaffold(
            topBar = {
              Column {
                TopAppBar(
                    navigationIcon = {
                        // In der Seitenleiste sitzt derselbe Knopf oben in der Leiste.
                        if (art == Navigationsart.LEISTE_UNTEN) {
                            IconButton(onClick = oeffneSchublade) {
                                Icon(Icons.Default.Menu, stringResource(R.string.nav_more),
                                    tint = if (isBrick) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    },
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
                            // Das Kontomenü trägt nur, was das Konto und die Sitzung betrifft. Die
                            // übrigen Seiten stehen gruppiert in der Schublade (MehrSchublade unten):
                            // zehn Einträge in einer Klappe waren nicht mehr zu überblicken.
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.konto_title)) },
                                onClick = {
                                    showLogoutMenu = false
                                    navController.navigate(Screen.Konto.route)
                                },
                                leadingIcon = { Icon(Icons.Default.AccountCircle, null) },
                            )
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
                            HorizontalDivider()
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
                        windowInsets = WindowInsets(0, 0, 0, 0),
                        header = {
                            IconButton(onClick = oeffneSchublade) {
                                Icon(Icons.Default.Menu, stringResource(R.string.nav_more))
                            }
                        },
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
}

/**
 * Die Seiten, die kein Bestandsreiter sind, in Gruppen: Preise, Bestand verwalten
 * und für Verwalter der Server. Eine Schublade statt eines sechsten Reiters, weil
 * Material unten höchstens fünf vorsieht. Jede Route steht ausgeschrieben da, weil
 * ErreichbareRoutenTest nach `navigate(Screen.X.route)` sucht.
 */
@Composable
private fun MehrSchublade(
    navController: androidx.navigation.NavController,
    isAdmin: Boolean,
    schliessen: () -> Unit,
) {
    ModalDrawerSheet(Modifier.widthIn(max = 320.dp)) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(vertical = 12.dp)) {
            Text(stringResource(R.string.app_name), style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 28.dp, vertical = 16.dp).semantics { heading() })
            SchubladenGruppe(R.string.nav_group_prices)
            // Gutscheine zuerst: Die braucht man im Laden.
            MenuZiel(R.string.vouchers_title, Icons.Default.Redeem) {
                schliessen(); navController.navigate(Screen.Gutscheine.route)
            }
            MenuZiel(R.string.alerts_group, Icons.Default.NotificationsActive) {
                schliessen(); navController.navigate(Screen.Preisalarme.route)
            }
            MenuZiel(R.string.nav_comparison, Icons.AutoMirrored.Filled.CompareArrows) {
                schliessen(); navController.navigate(Screen.Comparison.route)
            }
            SchubladenGruppe(R.string.nav_group_manage)
            MenuZiel(R.string.storage_manage, Icons.Default.Inventory2) {
                schliessen(); navController.navigate(Screen.Lagerorte.route)
            }
            MenuZiel(R.string.household_title, Icons.Default.Group) {
                schliessen(); navController.navigate(Screen.Haushalt.route)
            }
            MenuZiel(R.string.csv_upload_title, Icons.Default.UploadFile) {
                schliessen(); navController.navigate(Screen.CsvImport.route)
            }
            if (isAdmin) {
                SchubladenGruppe(R.string.nav_group_server)
                MenuZiel(R.string.main_menu_monitoring, Icons.Default.Assessment) {
                    schliessen()
                    navController.navigate(Screen.Monitoring.route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = false
                    }
                }
            }
        }
    }
}

/** Überschrift einer Gruppe in der Schublade. */
@Composable
private fun SchubladenGruppe(titel: Int) {
    Text(stringResource(titel), style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 28.dp, end = 28.dp, top = 16.dp, bottom = 8.dp).semantics { heading() })
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
 * Ein Eintrag der Schublade — ein Gerüst, damit kein Eintrag anders aussieht. Das
 * Zuklappen steht im Aufrufer.
 */
@Composable
private fun MenuZiel(
    titel: Int,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onKlick: () -> Unit,
) {
    NavigationDrawerItem(
        label = { Text(stringResource(titel)) },
        selected = false,
        onClick = onKlick,
        icon = { Icon(icon, null) },
        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
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
