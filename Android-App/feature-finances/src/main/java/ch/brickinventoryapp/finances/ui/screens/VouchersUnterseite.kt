package ch.brickinventoryapp.finances.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.PrivacyShield
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.ui.util.SecretClipboard
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.ui.components.Subpage
import androidx.compose.runtime.saveable.rememberSaveable
import ch.brickinventoryapp.finances.ui.VoucherUiState

/**
 * Vouchers — the first entry of the list, because they are needed in the
 * store: one tap away, without having to scroll past them when looking for
 * something else.
 */
@Composable
fun VouchersRoute(
    gvm: VoucherViewModel,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
) {
    val voucherState by gvm.state.collectAsStateWithLifecycle()
    PrivacyShield()
    // Copy the PIN and delete vouchers: no tap through an overlay.
    OverlayGuard()
    // Copying goes via SecretClipboard (empty again after one minute); the
    // feedback runs through the ViewModel's snackbar like every other message.
    val context = androidx.compose.ui.platform.LocalContext.current
    val tag = stringResource(R.string.vouchers_title)
    // The list loads as soon as this page observes the state (VoucherViewModel),
    // not when the settings are opened. The plain text only lives as long as the page is in front.
    DisposableEffect(Unit) { onDispose { gvm.leaveVouchers() } }
    androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_STOP) { gvm.forgetPlaintext() }
    // Number and PIN together are money: marked as a secret, gone after one minute.
    val job = voucherState.copyTo
    LaunchedEffect(job) {
        if (job == null) return@LaunchedEffect
        SecretClipboard.copy(context, tag, job.value)
        gvm.reportVoucherCopied(job.isNumber)
        gvm.copyAcknowledge()
    }
    VouchersPage(voucherState, snackbarHostState, onBack,
        onBalanceAll = { gvm.queryAllBalances() }, exportOn = { gvm.openVoucherExport() }) { newValue, onNew ->
        VouchersCard(
            condition = voucherState,
            onField = { n, p, b, w -> gvm.setVoucherField(n, p, b, w) },
            switchOnPin = { gvm.switchVoucherPin(it) },
            editOn = { gvm.editVoucher(it) },
            onCancel = { gvm.emptyVoucherForm() },
            onSave = { gvm.saveVoucher(it?.let { u -> FileRef(u.toString()) }) },
            deleteOn = { gvm.deleteVoucher(it) },
            openOnPdf = { gvm.openVoucherPdf(it) },
            onCopy = { id, isNumber -> gvm.copyVoucher(id, isNumber) },
            onBalance = { gvm.queryBalance(it) },
            cancelOnBalance = { gvm.cancelBalanceRun() },
            onAgain = { gvm.loadVouchers() },
            onConfirm = { password, code -> gvm.confirm(password, code) },
            cancelOnConfirmation = { gvm.cancelConfirmation() },
            newValue = newValue,
            onNew = onNew,
        )
    }
}

/**
 * The vouchers page: „Hinzufügen“ floats as the main action, the balance of all cards
 * and the PDF sit in the bar's menu. Three wide buttons above the list pushed the
 * cards out of view. [card] gets whether the create form is open.
 */
@Composable
fun VouchersPage(
    condition: VoucherUiState,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
    onBalanceAll: () -> Unit,
    exportOn: () -> Unit,
    card: @Composable (newValue: Boolean, onNew: (Boolean) -> Unit) -> Unit,
) {
    var newValue by rememberSaveable { mutableStateOf(false) }
    Subpage(
        stringResource(R.string.vouchers_title), snackbarHostState, onBack,
        actions = { VoucherMenu(condition, onBalanceAll, exportOn) },
        primaryAction = { VoucherAdd { newValue = true } },
    ) { card(newValue) { newValue = it } }
}
