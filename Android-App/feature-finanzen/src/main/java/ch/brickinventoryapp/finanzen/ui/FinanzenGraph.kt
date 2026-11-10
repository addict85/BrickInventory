package ch.brickinventoryapp.finanzen.ui

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import ch.brickinventoryapp.finanzen.ui.screens.FinanceRoute
import ch.brickinventoryapp.finanzen.ui.screens.GutscheinPdfSchutz
import ch.brickinventoryapp.finanzen.ui.screens.GutscheineRoute
import ch.brickinventoryapp.finanzen.ui.screens.PdfViewerRoute
import ch.brickinventoryapp.finanzen.ui.viewmodel.FinanzViewModel
import ch.brickinventoryapp.finanzen.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.finanzen.ui.viewmodel.gutscheinPdfAdresse
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.zustand.ui.Bereichsumgebung
import ch.brickinventoryapp.zustand.ui.Screen
import ch.brickinventoryapp.zustand.ui.rollSchluessel

/** Was die Finanzen von der App brauchen. */
interface FinanzenNavigation : Bereichsumgebung

/** Finanzen, Gutscheine und der PDF-Betrachter. */
fun NavGraphBuilder.finanzenGraph(navigation: FinanzenNavigation) {
    val navController = navigation.navController
    val financeListState = navigation.rollen.finanzen
    composable<Screen.Finance> {
        val vm = navigation.app
        val finanzen: FinanzViewModel = hiltViewModel()
        val state by finanzen.state.collectAsStateWithLifecycle()
        val financeState by finanzen.financeState.collectAsStateWithLifecycle()
        LaunchedEffect(state.serverUrl) { if (state.serverUrl.isNotBlank() && financeState.valuation == null) finanzen.loadValuation() }
        navigation.Reiter(stringResource(R.string.nav_finance)) {
            LaunchedEffect(state.serverUrl) {
                if (state.serverUrl.isNotBlank() && financeState.historyPoints.isEmpty()) finanzen.loadPortfolioHistory()
            }
            ScrollPositionKeeper(
                Screen.Finance.rollSchluessel, financeListState,
                financeState.valuation != null, vm.scrollMemory)
            FinanceRoute(
                vm = finanzen,
                imageLoader = navigation.bilder,
                // Klick auf eine Zeile öffnet dieselbe Detailansicht wie in der Galerie. Der
                // Scroll-Zustand liegt ausserhalb (financeListState), damit die Rückkehr an
                // derselben Stelle landet.
                onSetClick = { navController.navigate(Screen.SetDetail(it)) },
                // Den Namen gibt die angeklickte Zeile mit, sonst stünde bis zum ersten
                // Laden die nackte Nummer in der Leiste.
                onManualClick = { type, id, colorId, name ->
                    navController.navigate(Screen.ManualItemDetail(type, id, colorId, name ?: id))
                },
                listState = financeListState
            )
        }
    }
    composable<Screen.Gutscheine> {
        val vm = navigation.app
        // Am Ziel: Klartext und PIN enden mit der Seite. Der PDF-Betrachter liegt
        // darüber, die Seite bleibt also bestehen, solange er offen ist.
        val gutscheinVm: GutscheinViewModel = hiltViewModel()
        val state by vm.state.collectAsStateWithLifecycle()
        val gutscheine by gutscheinVm.state.collectAsStateWithLifecycle()
        // Ein freigegebenes Gutschein-PDF (eines oder alle): Das Ziel mit Ticket
        // steht im Zustand, die Navigation macht der Graph. Der Titel wird AUSSERHALB
        // des LaunchedEffect gelesen: stringResource ist @Composable.
        val exportTitel = stringResource(R.string.vouchers_export)
        LaunchedEffect(gutscheine.pdfZiel) {
            val ziel = gutscheine.pdfZiel ?: return@LaunchedEffect
            val titel = if (ziel.id == null) exportTitel
                else gutscheine.gutscheine.find { it.id == ziel.id }?.number.orEmpty()
            navController.navigate(Screen.PdfViewer(
                gutscheinPdfAdresse(state.serverUrl, ziel), titel))
            gutscheinVm.gutscheinPdfQuittieren()
        }
        GutscheineRoute(gutscheinVm, navigation.snackbar) { navController.popBackStack() }
    }
    composable<Screen.PdfViewer> { backStackEntry ->
        val ziel = backStackEntry.toRoute<Screen.PdfViewer>()
        GutscheinPdfSchutz(ziel.url)
        val state by navigation.app.state.collectAsStateWithLifecycle()
        PdfViewerRoute(
            pdfUrl = ziel.url,
            title  = ziel.title,
            serverUrl = state.serverUrl,
            onBack = { navController.popBackStack() }
        )
    }
}
