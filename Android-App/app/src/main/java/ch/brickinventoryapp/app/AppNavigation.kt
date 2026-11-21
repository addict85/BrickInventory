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
import ch.brickinventoryapp.login.ui.loginGraph
import ch.brickinventoryapp.login.ui.LoginTarget
import ch.brickinventoryapp.finances.ui.FinanzZiel
import ch.brickinventoryapp.finances.ui.financesGraph
import ch.brickinventoryapp.catalog.ui.KatalogZiel
import ch.brickinventoryapp.catalog.ui.catalogGraph
import ch.brickinventoryapp.account.ui.accountGraph
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.collection.ui.SammlungZiel
import ch.brickinventoryapp.collection.ui.collectionGraph
import ch.brickinventoryapp.parts.ui.partsGraph
import ch.brickinventoryapp.management.ui.managementGraph
import ch.brickinventoryapp.state.ui.StartTarget
import ch.brickinventoryapp.state.ui.startTarget
import coil3.ImageLoader
import ch.brickinventoryapp.resources.R
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.app.nav.ActivityState
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.data.util.LanguageManager
import android.content.Context
import androidx.compose.ui.platform.LocalContext
import ch.brickinventoryapp.app.nav.Reiter
import ch.brickinventoryapp.app.nav.TargetEnvironment
import ch.brickinventoryapp.ui.components.TransitionFrame
import ch.brickinventoryapp.account.ui.dialogs.UpdateRoute
import ch.brickinventoryapp.app.nav.AppTarget
import ch.brickinventoryapp.app.nav.moreTarget

/**
 * App navigation and main scaffold: the NavHost with all routes, the dialogs that
 * stand above every screen, and the MainScaffold (TopBar/BottomBar). In the package
 * of MainActivity so that they find each other without an import.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrickInventoryRoute(
    aktivitaet: ActivityState,
    imageLoader: coil3.ImageLoader,
) {
    val vm = aktivitaet.app
    // collectAsStateWithLifecycle: collection stops when the app is in the
    // background — no unnecessary recomposition/state processing any more.
    val state by vm.state.collectAsStateWithLifecycle()
    val selbstUpdate = aktivitaet.update
    val navController = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    // Only the ScrollMemory holds scroll positions: every destination creates its list state
    // itself and restores the position with ScrollPositionKeeper.

    // Snackbar from its own flow — messages thus no longer recompose the
    // whole tree via AppUiState.
    val snackbarMsg by vm.snackbar.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    LaunchedEffect(snackbarMsg) {
        snackbarMsg?.let {
            snackbarHostState.showSnackbar(it.asSet(ctx))
            vm.clearSnackbar()
        }
    }

    // CSV stream, update check and reloading in the foreground are triggered by ViewModels and
    // activity (CsvImportViewModel, UpdateViewModel, MainActivity.onResume), not
    // by the composition.

    val startDest = startRoute(startTarget(state.serverUrl, state.isLoggedIn, NetworkPolicy.entwicklung))
    val root: Any = if (startDest == SammlungZiel.Gallery) SammlungZiel.Gallery else LoginTarget.Bereich
    // The start of the sign-in stays as long as it runs: another one would rebuild the graph
    // and end its ViewModel in the middle of the QR sign-in.
    val loginStart = remember(root) { startDest as? LoginTarget ?: LoginTarget.Setup }
    val bottomNavItems = tabTheBar()

    // ── “There is a new version” — also above everything ──
    //
    // A hint at start with yes/no, because a dot in the settings is easily
    // overlooked. Here, because the question concerns the whole app; the triggering check
    // is a few lines further up.
    UpdateRoute(selbstUpdate)

    // A tapped price alert notification opens its set — here, because the
    // NavController only exists in this composition. Only signed in; otherwise
    // the target stays and is redeemed after the sign-in.
    val messageTarget by vm.messageTarget.collectAsStateWithLifecycle()
    LaunchedEffect(messageTarget.setNummer, startDest) {
        val sn = messageTarget.setNummer
        if (sn != null && startDest == SammlungZiel.Gallery) {
            navController.navigate(SammlungZiel.SetDetail(sn))
            // Acknowledge immediately, otherwise the app jumps again on the next
            // recomposition — the same rule as for manual
            // adding after an unsuccessful scan.
            vm.setFromMessageAcknowledge()
        }
    }

    // The common scope for element transitions (gallery → set detail); the
    // predictive back plays the same transition backwards.
    TransitionFrame {
    // Subtle transitions: fade in briefly and move up a bit, back in the
    // opposite direction. The default (700 ms pure crossfade) felt sluggish.
    NavHost(navController, startDestination = root,
        enterTransition = { fadeIn(tween(TRANSITION_MS)) + slideInHorizontally(tween(TRANSITION_MS)) { it / 16 } },
        exitTransition = { fadeOut(tween(TRANSITION_MS / 2)) },
        popEnterTransition = { fadeIn(tween(TRANSITION_MS)) },
        popExitTransition = { fadeOut(tween(TRANSITION_MS / 2)) + slideOutHorizontally(tween(TRANSITION_MS)) { it / 16 } },
    ) {
        // No state passed in: the NavHost builder runs only once, a passed-in
        // value would stay the snapshot of the first frame. The destinations read themselves.
        allTargets(TargetEnvironment(navController, imageLoader, bottomNavItems,
            snackbarHostState) { aktivitaet }, loginStart)
    }
    }
}

/**
 * All destinations of the app; the NavHost and ReachableRoutesTest build the same graph.
 * Every area brings its destinations along, the app only assembles them.
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

/** Where the app starts, depending on whether server and sign-in already exist. */
internal fun startRoute(ziel: StartTarget): Any = when (ziel) {
    StartTarget.EINRICHTUNG -> LoginTarget.Setup
    StartTarget.LOGIN   -> LoginTarget.Login
    StartTarget.SAMMLUNG    -> SammlungZiel.Gallery
}

/**
 * Four inventory destinations and “More” — Material provides at most five; the rest stands
 * grouped on “More”. Icons without description: the label stands next to them,
 * otherwise TalkBack reads twice. Wishlist before the catalog, as in the web app.
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
 * The UI forms the snackbar sentence, in the app's language (LanguageManager);
 * outside the composition, hence not via [ch.brickinventoryapp.ui.satz]. A value
 * that is itself a message is formed first.
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

/** Duration of a page change; short enough not to hold things up. */
private const val TRANSITION_MS = 220
