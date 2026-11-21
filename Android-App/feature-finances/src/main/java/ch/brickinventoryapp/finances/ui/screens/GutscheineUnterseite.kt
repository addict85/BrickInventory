package ch.brickinventoryapp.finances.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.finances.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.ui.util.SecretClipboard
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.ui.components.Subpage
import androidx.compose.runtime.saveable.rememberSaveable
import ch.brickinventoryapp.finances.ui.GutscheinUiState

/**
 * Vouchers — the first entry of the list, because they are needed in the
 * store: one tap away, without having to scroll past them when looking for
 * something else.
 */
@Composable
fun VouchersRoute(
    gvm: GutscheinViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val voucherState by gvm.state.collectAsStateWithLifecycle()
    Sichtschutz()
    // Copy the PIN and delete vouchers: no tap through an overlay.
    Ueberdeckungsschutz()
    // Copying goes via SecretClipboard (empty again after one minute); the
    // feedback runs through the ViewModel's snackbar like every other message.
    val context = androidx.compose.ui.platform.LocalContext.current
    val etikett = stringResource(R.string.vouchers_title)
    // The list loads as soon as this page observes the state (GutscheinViewModel),
    // not when the settings are opened. The plain text only lives as long as the page is in front.
    DisposableEffect(Unit) { onDispose { gvm.leaveVouchers() } }
    androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_STOP) { gvm.forgetPlaintext() }
    // Number and PIN together are money: marked as a secret, gone after one minute.
    val job = voucherState.copyTo
    LaunchedEffect(job) {
        if (job == null) return@LaunchedEffect
        SecretClipboard.copy(context, etikett, job.wert)
        gvm.reportVoucherCopied(job.isNumber)
        gvm.copyAcknowledge()
    }
    VouchersPage(voucherState, snackbarHostState, onZurueck,
        onBalanceAll = { gvm.questionAllBalanceAb() }, exportOn = { gvm.openVoucherExport() }) { neu, onNew ->
        GutscheineCard(
            zustand = voucherState,
            onFeld = { n, p, b, w -> gvm.setVoucherField(n, p, b, w) },
            switchOnPin = { gvm.switchVoucherPin(it) },
            editOn = { gvm.editVoucher(it) },
            onAbbrechen = { gvm.emptyVoucherForm() },
            onSpeichern = { gvm.saveVoucher(it?.let { u -> FileRef(u.toString()) }) },
            deleteOn = { gvm.deleteVoucher(it) },
            openOnPdf = { gvm.openVoucherPdf(it) },
            onKopieren = { id, isNumber -> gvm.copyVoucher(id, isNumber) },
            onBalance = { gvm.questionBalanceAb(it) },
            cancelOnBalance = { gvm.cancelBalanceRun() },
            onErneut = { gvm.loadVouchers() },
            onBestaetigen = { passwort, code -> gvm.confirm(passwort, code) },
            cancelOnConfirmation = { gvm.cancelConfirmation() },
            neu = neu,
            onNew = onNew,
        )
    }
}

/**
 * The vouchers page: „Hinzufügen“ floats as the main action, the balance of all cards
 * and the PDF sit in the bar's menu. Three wide buttons above the list pushed the
 * cards out of view. [karte] gets whether the create form is open.
 */
@Composable
fun VouchersPage(
    zustand: GutscheinUiState,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
    onBalanceAll: () -> Unit,
    exportOn: () -> Unit,
    karte: @Composable (neu: Boolean, onNew: (Boolean) -> Unit) -> Unit,
) {
    var neu by rememberSaveable { mutableStateOf(false) }
    Subpage(
        stringResource(R.string.vouchers_title), snackbarHostState, onZurueck,
        aktionen = { VoucherMenu(zustand, onBalanceAll, exportOn) },
        primaryAction = { VoucherAdd { neu = true } },
    ) { karte(neu) { neu = it } }
}
