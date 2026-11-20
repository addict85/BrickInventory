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

/** Was die Finanzen von der App brauchen: Set und Einzelstück gehören anderen Bereichen. */
interface FinancesNavigation : Bereichsumgebung {
    fun openSet(setNumber: String)
    fun openSinglePiece(art: Postenart, id: String, colorId: Int, titel: String)

    /** Der PDF-Betrachter; die Route trägt nur einen Schlüssel (PdfSelection). */
    fun showPdf(url: String, titel: String) = navController.navigate(FinanzZiel.PdfViewer(PdfSelection.put(url, titel)))
}

/** Finanzen, Gutscheine und der PDF-Betrachter. */
fun NavGraphBuilder.financesGraph(navigation: FinancesNavigation) {
    val navController = navigation.navController
    composable<FinanzZiel.Finance> {
        // Ein Zustand je Besuch; die Stelle hält allein der ScrollMemory (Keeper unten).
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
                // Klick auf eine Zeile öffnet dieselbe Detailansicht wie in der Galerie.
                onSetClick = navigation::openSet,
                // Den Namen gibt die angeklickte Zeile mit, sonst stünde bis zum ersten
                // Laden die nackte Nummer in der Leiste.
                onManualClick = { type, id, colorId, name ->
                    navigation.openSinglePiece(type, id, colorId, name ?: id)
                },
                listState = financeListState
            )
        }
    }
    composable<FinanzZiel.Gutscheine> {
        // Am Ziel: Klartext und PIN enden mit der Seite. Der PDF-Betrachter liegt
        // darüber, die Seite bleibt also bestehen, solange er offen ist.
        val voucherVm: GutscheinViewModel = hiltViewModel()
        val state by navigation.sitzung.collectAsStateWithLifecycle()
        val gutscheine by voucherVm.state.collectAsStateWithLifecycle()
        // Ein freigegebenes Gutschein-PDF (eines oder alle): Das Ziel mit Ticket
        // steht im Zustand, die Navigation macht der Graph. Der Titel wird AUSSERHALB
        // des LaunchedEffect gelesen: stringResource ist @Composable.
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
            // Nach einem Prozess-Tod ist die Auswahl weg: zurück, statt leer zu zeigen.
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
