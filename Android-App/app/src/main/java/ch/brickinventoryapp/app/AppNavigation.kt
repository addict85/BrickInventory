package ch.brickinventoryapp.app

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.automirrored.filled.ShowChart
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.navigation.compose.*
import ch.brickinventoryapp.anmeldung.ui.loginGraph
import ch.brickinventoryapp.anmeldung.ui.LoginTarget
import ch.brickinventoryapp.finanzen.ui.FinanzZiel
import ch.brickinventoryapp.finanzen.ui.financesGraph
import ch.brickinventoryapp.katalog.ui.KatalogZiel
import ch.brickinventoryapp.katalog.ui.catalogGraph
import ch.brickinventoryapp.konto.ui.accountGraph
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.sammlung.ui.SammlungZiel
import ch.brickinventoryapp.sammlung.ui.collectionGraph
import ch.brickinventoryapp.teile.ui.partsGraph
import ch.brickinventoryapp.verwaltung.ui.managementGraph
import ch.brickinventoryapp.zustand.ui.StartTarget
import ch.brickinventoryapp.zustand.ui.startTarget
import coil3.ImageLoader
import ch.brickinventoryapp.ressourcen.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.app.nav.ActivityState
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.data.util.LanguageManager
import android.content.Context
import androidx.compose.ui.platform.LocalContext
import ch.brickinventoryapp.app.nav.Reiter
import ch.brickinventoryapp.app.nav.TargetEnvironment
import ch.brickinventoryapp.ui.components.TransitionFrame
import ch.brickinventoryapp.konto.ui.dialogs.UpdateRoute
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.app.nav.moreTarget

/**
 * App-Navigation und Haupt-Gerüst: der NavHost mit allen Routen, die Dialoge, die
 * über jedem Bildschirm stehen, und das MainScaffold (TopBar/BottomBar). Im Paket
 * von MainActivity, damit sie sich ohne Import finden.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrickInventoryRoute(
    aktivitaet: ActivityState,
    imageLoader: coil3.ImageLoader,
) {
    val vm = aktivitaet.app
    // collectAsStateWithLifecycle: Collection stoppt, wenn die App im
    // Hintergrund ist — kein unnötiges Recomposition-/State-Processing mehr.
    val state by vm.state.collectAsStateWithLifecycle()
    val selbstUpdate = aktivitaet.update
    val navController = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    // Rollpositionen hält allein der ScrollMemory: Jedes Ziel legt seinen Listenzustand
    // selbst an und stellt die Stelle mit ScrollPositionKeeper wieder her.

    // Snackbar aus eigenem Flow — Meldungen rekomponieren so nicht mehr den
    // gesamten Tree über AppUiState.
    val snackbarMsg by vm.snackbar.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    LaunchedEffect(snackbarMsg) {
        snackbarMsg?.let {
            snackbarHostState.showSnackbar(it.asSet(ctx))
            vm.clearSnackbar()
        }
    }

    // CSV-Strom, Update-Prüfung und das Nachladen im Vordergrund stossen ViewModels und
    // Activity an (CsvImportViewModel, UpdateViewModel, MainActivity.onResume), nicht
    // die Komposition.

    val startDest = startRoute(startTarget(state.serverUrl, state.isLoggedIn, NetworkPolicy.entwicklung))
    val root: Any = if (startDest == SammlungZiel.Gallery) SammlungZiel.Gallery else LoginTarget.Bereich
    // Der Beginn der Anmeldung bleibt, solange sie läuft: Ein anderer baute den Graphen
    // neu und beendete ihr ViewModel mitten in der QR-Anmeldung.
    val loginStart = remember(root) { startDest as? LoginTarget ?: LoginTarget.Setup }
    val bottomNavItems = tabTheBar()

    // ── „Es gibt eine neue Fassung“ — ebenfalls über allem ──
    //
    // Ein Hinweis beim Start mit Ja/Nein, weil ein Punkt in den Einstellungen leicht
    // übersehen wird. Hier, weil die Frage der ganzen App gilt; die auslösende Prüfung
    // steht ein paar Zeilen weiter oben.
    UpdateRoute(selbstUpdate)

    // Eine angetippte Preisalarm-Meldung öffnet ihr Set — hier, weil es den
    // NavController erst in dieser Composition gibt. Nur angemeldet; sonst bleibt
    // das Ziel stehen und wird nach der Anmeldung eingelöst.
    val messageTarget by vm.messageTarget.collectAsStateWithLifecycle()
    LaunchedEffect(messageTarget.setNummer, startDest) {
        val sn = messageTarget.setNummer
        if (sn != null && startDest == SammlungZiel.Gallery) {
            navController.navigate(SammlungZiel.SetDetail(sn))
            // Sofort quittieren, sonst springt die App bei der naechsten
            // Rekomposition erneut — dieselbe Regel wie bei der manuellen
            // Erfassung nach einem erfolglosen Scan.
            vm.setFromMessageAcknowledge()
        }
    }

    // Der gemeinsame Raum für Elementübergänge (Galerie → Set-Detail); das
    // vorhersagbare Zurück spielt denselben Übergang rückwärts.
    TransitionFrame {
    // Dezente Übergänge: kurz einblenden und ein Stück nachrücken, zurück in die
    // Gegenrichtung. Die Vorgabe (700 ms reines Überblenden) wirkte träge.
    NavHost(navController, startDestination = root,
        enterTransition = { fadeIn(tween(TRANSITION_MS)) + slideInHorizontally(tween(TRANSITION_MS)) { it / 16 } },
        exitTransition = { fadeOut(tween(TRANSITION_MS / 2)) },
        popEnterTransition = { fadeIn(tween(TRANSITION_MS)) },
        popExitTransition = { fadeOut(tween(TRANSITION_MS / 2)) + slideOutHorizontally(tween(TRANSITION_MS)) { it / 16 } },
    ) {
        // Kein Zustand hinein: Der NavHost-Builder läuft nur einmal, ein durchgereichter
        // Wert bliebe die Momentaufnahme des ersten Frames. Die Ziele lesen selbst.
        allTargets(TargetEnvironment(navController, imageLoader, bottomNavItems,
            snackbarHostState) { aktivitaet }, loginStart)
    }
    }
}

/**
 * Alle Ziele der App; der NavHost und ReachableRoutesTest bauen denselben Graphen.
 * Jeder Bereich bringt seine Ziele mit, die App setzt sie nur zusammen.
 */
internal fun androidx.navigation.NavGraphBuilder.allTargets(u: TargetEnvironment, loginStart: LoginTarget = LoginTarget.Setup) {
    loginGraph(u, loginStart)
    collectionGraph(u)
    catalogGraph(u)
    partsGraph(u)
    financesGraph(u)
    accountGraph(u)
    managementGraph(u)
    moreTarget(u)
}

/** Wo die App beginnt, je nachdem, ob Server und Anmeldung schon da sind. */
internal fun startRoute(ziel: StartTarget): Any = when (ziel) {
    StartTarget.EINRICHTUNG -> LoginTarget.Setup
    StartTarget.LOGIN   -> LoginTarget.Login
    StartTarget.SAMMLUNG    -> SammlungZiel.Gallery
}

/**
 * Vier Bestandsziele und „Mehr“ — Material sieht höchstens fünf vor; der Rest steht
 * gruppiert auf „Mehr“. Symbole ohne Beschreibung: Die Beschriftung steht daneben,
 * sonst liest TalkBack doppelt. Merkliste vor dem Katalog, wie in der Webapp.
 */
@Composable
internal fun tabTheBar(): List<Reiter> {
    val sammlung = stringResource(R.string.nav_collection)
    val finanzen = stringResource(R.string.nav_finance)
    val merkliste = stringResource(R.string.nav_wanted)
    val katalog = stringResource(R.string.nav_catalog)
    val mehr = stringResource(R.string.nav_more)
    return remember(sammlung, finanzen, merkliste, katalog, mehr) {
        listOf(
            Reiter(SammlungZiel.Gallery, { Icon(Icons.Default.ViewInAr, null) }, sammlung),
            Reiter(FinanzZiel.Finance, { Icon(Icons.AutoMirrored.Filled.ShowChart, null) }, finanzen),
            Reiter(SammlungZiel.Wanted, { Icon(Icons.Default.BookmarkBorder, null) }, merkliste),
            Reiter(KatalogZiel.Catalog, { Icon(Icons.AutoMirrored.Filled.MenuBook, null) }, katalog),
            Reiter(AppTarget.Mehr, { Icon(Icons.Default.MoreHoriz, null) }, mehr),
        )
    }
}

/**
 * Den Satz der Snackbar bildet die Oberfläche, in der Sprache der App (LanguageManager);
 * ausserhalb der Komposition, darum nicht über [ch.brickinventoryapp.ui.satz]. Ein Wert,
 * der selbst eine Meldung ist, wird zuerst gebildet.
 */
internal fun Meldung.asSet(ctx: Context): String {
    val c = LanguageManager.localizedContext(ctx)
    return when (this) {
        is Meldung.Text -> text
        is Meldung.Resource ->
            if (werte.isEmpty()) c.getString(id) else c.getString(id, *werte.map { w -> if (w is Meldung) w.asSet(ctx) else w }.toTypedArray())
        is Meldung.Menge -> c.resources.getQuantityString(id, anzahl, *werte.map { w -> if (w is Meldung) w.asSet(ctx) else w }.toTypedArray())
    }
}

/** Dauer eines Seitenwechsels; kurz genug, dass er nicht aufhält. */
private const val TRANSITION_MS = 220
