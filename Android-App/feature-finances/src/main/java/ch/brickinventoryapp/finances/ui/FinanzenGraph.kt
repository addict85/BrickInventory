package ch.brickinventoryapp.finances.ui

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.finances.ui.screens.VoucherPdfProtection
import ch.brickinventoryapp.finances.ui.screens.VouchersRoute
import ch.brickinventoryapp.finances.ui.screens.PdfViewerRoute
import ch.brickinventoryapp.finances.ui.viewmodel.FinanceViewModel
import ch.brickinventoryapp.finances.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.navigation.Bereichsumgebung

/** What finances need from the app: set and individual item belong to other areas. */
interface FinancesNavigation : Bereichsumgebung {
    fun openSet(setNumber: String)
    fun openSinglePiece(art: Postenart, id: String, colorId: Int, titel: String)

    /** The PDF viewer; the route carries only one key (PdfSelection). */
    fun showPdf(url: String, titel: String) = navController.navigate(FinanzZiel.PdfViewer(PdfSelection.put(url, titel)))
}

/** Finances, vouchers and the PDF viewer. */
fun NavGraphBuilder.financesGraph(navigation: FinancesNavigation) {
    val navController = navigation.navController
    composable<FinanzZiel.Finance> {
        // One state per visit; only the ScrollMemory (Keeper below) holds the position.
        val financeListState = remember { LazyListState() }
        val finanzen: FinanceViewModel = hiltViewModel()
        val financeState by finanzen.financeState.collectAsStateWithLifecycle()
        navigation.Reiter(stringResource(R.string.nav_finance)) {
            ScrollPositionKeeper(
                FinanzZiel.Finance.rollSchluessel, financeListState,
                financeState.valuation != null, navigation.rollgedaechtnis)
            FinanceRoute(
                vm = finanzen,
                imageLoader = navigation.bilder,
                // Clicking a row opens the same detail view as in the gallery.
                onSetClick = navigation::openSet,
                // The clicked row supplies the name along with it, otherwise the bare
                // number would stand in the bar until the first load.
                onManualClick = { type, id, colorId, name ->
                    navigation.openSinglePiece(type, id, colorId, name ?: id)
                },
                listState = financeListState
            )
        }
    }
    composable<FinanzZiel.Gutscheine> {
        // On the target: plain text and PIN end with the page. The PDF viewer lies
        // above it, so the page stays alive as long as it is open.
        val voucherVm: GutscheinViewModel = hiltViewModel()
        val state by navigation.sitzung.collectAsStateWithLifecycle()
        val gutscheine by voucherVm.state.collectAsStateWithLifecycle()
        // A released voucher PDF (one or all): the target with the ticket
        // lives in the state, the graph does the navigation. The title is read OUTSIDE
        // the LaunchedEffect: stringResource is @Composable.
        val exportTitle = stringResource(R.string.vouchers_export)
        LaunchedEffect(gutscheine.pdfTarget) {
            val ziel = gutscheine.pdfTarget ?: return@LaunchedEffect
            val titel = if (ziel.id == null) exportTitle
                else gutscheine.gutscheine.find { it.id == ziel.id }?.number.orEmpty()
            navigation.showPdf(voucherPdfAddress(state.serverUrl, ziel), titel)
            voucherVm.voucherPdfAcknowledge()
        }
        VouchersRoute(voucherVm, navigation.snackbar) { navController.popBackStack() }
    }
    composable<FinanzZiel.PdfViewer> { backStackEntry ->
        val ziel = backStackEntry.toRoute<FinanzZiel.PdfViewer>()
        val pdf = remember(ziel.schluessel) { PdfSelection.fetch(ziel.schluessel) }
        if (pdf == null) {
            // After a process death the selection is gone: go back instead of showing it empty.
            LaunchedEffect(Unit) { navController.popBackStack() }
            return@composable
        }
        VoucherPdfProtection(pdf.url)
        val state by navigation.sitzung.collectAsStateWithLifecycle()
        PdfViewerRoute(
            pdfUrl = pdf.url,
            title  = pdf.titel,
            serverUrl = state.serverUrl,
            onBack = { navController.popBackStack() }
        )
    }
}
