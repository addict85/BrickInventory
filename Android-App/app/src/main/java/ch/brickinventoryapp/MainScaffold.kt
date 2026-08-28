package ch.brickinventoryapp

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
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
    onLogout: () -> Unit,
    @Suppress("UNUSED_PARAMETER") serverUrl: String,
    isAdmin: Boolean = false,
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

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        // Icon des aktuell gewählten Tabs links vom Namen anzeigen —
                        // dasselbe Icon wie in der unteren Navigationsleiste, damit
                        // oben und unten konsistent sind. Das frühere feste App-Logo
                        // entfällt, damit oben links nur noch das Reiter-Icon steht.
                        val currentTabIcon = bottomNavItems.firstOrNull { (screen, _, _) ->
                            currentDest?.hierarchy?.any { it.route == screen.route } == true
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
                        Icon(Icons.Default.AccountCircle, stringResource(R.string.main_account), tint = if (isBrick) MaterialTheme.colorScheme.onPrimary else ch.brickinventoryapp.ui.theme.ChartNewClassic)
                    }
                    DropdownMenu(showLogoutMenu, { showLogoutMenu = false }) {
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
                            HorizontalDivider()
                        }
                        DropdownMenuItem(text = { Text(stringResource(R.string.main_menu_logout)) }, onClick = { showLogoutMenu = false; onLogout() },
                            leadingIcon = { Icon(Icons.AutoMirrored.Filled.Logout, null) })
                        DropdownMenuItem(text = { Text(stringResource(R.string.main_menu_change_server)) }, onClick = {
                            showLogoutMenu = false
                            navController.navigate(Screen.Setup.route)
                        }, leadingIcon = { Icon(Icons.Default.Cloud, null) })
                    }
                }
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                tonalElevation = 3.dp
            ) {
                bottomNavItems.forEach { (screen, icon, label) ->
                    NavigationBarItem(
                        icon = icon,
                        label = { Text(label, style = MaterialTheme.typography.labelSmall) },
                        selected = currentDest?.hierarchy?.any { it.route == screen.route } == true,
                        onClick = {
                            // Rollposition dieses Reiters verwerfen — siehe
                            // onTabAngetippt oben (Nachtrag 114).
                            onTabAngetippt(screen)
                            // Also pop Monitoring if it's on the stack
                            if (navController.currentBackStackEntry?.destination?.route == Screen.Monitoring.route) {
                                navController.popBackStack()
                            }
                            navController.navigate(screen.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        }
                    )
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
    ) { padding ->
        // Globaler CSV-Import-Balken: erscheint auf allen Tabs (wie in der
        // Webapp), sobald ein Import läuft — egal von wo er gestartet wurde.
        val csvImport by csvImportState.collectAsStateWithLifecycle()
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (csvImport.running) {
                CsvImportBanner(
                    done = csvImport.done, total = csvImport.total, current = csvImport.current,
                    ok = csvImport.ok, warn = csvImport.warn, err = csvImport.err, running = csvImport.running
                )
            }
            Box(Modifier.fillMaxSize()) { content() }
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
    MainScaffold(
        title = titel,
        navController = navController,
        bottomNavItems = bottomNavItems,
        snackbarHostState = snackbarHostState,
        csvImportState = vm.csvImportState,
        // Reiter angetippt → oben anfangen (Nachtrag 114).
        onTabAngetippt = { ziel -> vm.scrollMemory.vergissReiter(ziel.route) },
        onLogout = {
            vm.logout()
            navController.navigate(Screen.Login.route) { popUpTo(0) { inclusive = true } }
        },
        serverUrl = state.serverUrl,
        isAdmin = state.isAdmin,
        content = content
    )
}
