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
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.ScrollPositionKeeper
import ch.brickinventoryapp.navigation.AreaEnvironment

/** What finances need from the app: set and individual item belong to other areas. */
interface FinancesNavigation : AreaEnvironment {
    fun openSet(setNumber: String)
    fun openSinglePiece(kind: ItemKind, id: String, colorId: Int, title: String)

    /** The PDF viewer; the route carries only one key (PdfSelection). */
    fun showPdf(url: String, title: String) = navController.navigate(FinanceTarget.PdfViewer(PdfSelection.put(url, title)))
}

/** Finances, vouchers and the PDF viewer. */
fun NavGraphBuilder.financesGraph(navigation: FinancesNavigation) {
    val navController = navigation.navController
    composable<FinanceTarget.Finance> {
        // One state per visit; only the ScrollMemory (Keeper below) holds the position.
        val financeListState = remember { LazyListState() }
        val finances: FinanceViewModel = hiltViewModel()
        val financeState by finances.financeState.collectAsStateWithLifecycle()
        navigation.Tab(stringResource(R.string.nav_finance)) {
            ScrollPositionKeeper(
                FinanceTarget.Finance.rollKey, financeListState,
                financeState.valuation != null, navigation.scrollMemory)
            FinanceRoute(
                vm = finances,
                imageLoader = navigation.images,
                // Clicking a row opens the same detail view as in the gallery.
                onSetClick = navigation::openSet,
                // The clicked row supplies the name along with it, otherwise the bare
                // number would stand in the bar until the first load.
                onManualClick = { type, id, colorId, name ->
                    navigation.openSinglePiece(type, id, colorId, name ?: id)
                },
                listState = financeListState,
                onOpenVouchers = { navController.navigate(FinanceTarget.Vouchers) },
            )
        }
    }
    composable<FinanceTarget.Vouchers> {
        // On the target: plain text and PIN end with the page. The PDF viewer lies
        // above it, so the page stays alive as long as it is open.
        val voucherVm: VoucherViewModel = hiltViewModel()
        val state by navigation.session.collectAsStateWithLifecycle()
        val vouchers by voucherVm.state.collectAsStateWithLifecycle()
        // A released voucher PDF (one or all): the target with the ticket
        // lives in the state, the graph does the navigation. The title is read OUTSIDE
        // the LaunchedEffect: stringResource is @Composable.
        val exportTitle = stringResource(R.string.vouchers_export)
        LaunchedEffect(vouchers.pdfTarget) {
            val target = vouchers.pdfTarget ?: return@LaunchedEffect
            val title = if (target.id == null) exportTitle
                else vouchers.vouchers.find { it.id == target.id }?.number.orEmpty()
            navigation.showPdf(voucherPdfAddress(state.serverUrl, target), title)
            voucherVm.voucherPdfAcknowledge()
        }
        VouchersRoute(voucherVm, navigation.snackbar) { navController.popBackStack() }
    }
    composable<FinanceTarget.PdfViewer> { backStackEntry ->
        val target = backStackEntry.toRoute<FinanceTarget.PdfViewer>()
        val pdf = remember(target.key) { PdfSelection.fetch(target.key) }
        if (pdf == null) {
            // After a process death the selection is gone: go back instead of showing it empty.
            LaunchedEffect(Unit) { navController.popBackStack() }
            return@composable
        }
        VoucherPdfProtection(pdf.url)
        val state by navigation.session.collectAsStateWithLifecycle()
        PdfViewerRoute(
            pdfUrl = pdf.url,
            title  = pdf.title,
            serverUrl = state.serverUrl,
            onBack = { navController.popBackStack() }
        )
    }
}
