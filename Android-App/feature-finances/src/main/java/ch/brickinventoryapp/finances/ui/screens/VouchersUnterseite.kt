package ch.brickinventoryapp.finances.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.finances.ui.VoucherUiState
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.components.PrivacyShield
import ch.brickinventoryapp.ui.components.Subpage
import ch.brickinventoryapp.ui.components.UndoMessage
import ch.brickinventoryapp.ui.util.SecretClipboard

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
    UndoMessage(voucherState.deleted, stringResource(R.string.vouchers_deleted), snackbarHostState,
        onUndo = gvm::restoreVoucher, executeOn = { gvm.deletedAcknowledge() })
    VouchersPage(voucherState, snackbarHostState, onBack,
        onBalanceAll = { gvm.queryAllBalances() }, exportOn = { gvm.openVoucherExport() }) { newValue, onNew ->
        VouchersCard(
            condition = voucherState,
            actions = object : VoucherCardActions {
                override fun setField(number: String?, pin: String?, amount: String?, currency: String?) =
                    gvm.setVoucherField(number, pin, amount, currency)
                override fun switchPin(id: Int) = gvm.switchVoucherPin(id)
                override fun edit(id: Int) = gvm.editVoucher(id)
                override fun cancelEdit() = gvm.emptyVoucherForm()
                override fun save(pdf: android.net.Uri?) = gvm.saveVoucher(pdf?.let { u -> FileRef(u.toString()) })
                override fun delete(id: Int) = gvm.deleteVoucher(id)
                override fun openPdf(id: Int) = gvm.openVoucherPdf(id)
                override fun copy(id: Int, isNumber: Boolean) = gvm.copyVoucher(id, isNumber)
                override fun queryBalance(id: Int) = gvm.queryBalance(id)
                override fun cancelBalanceRun() = gvm.cancelBalanceRun()
                override fun reload() = gvm.loadVouchers()
                override fun confirm(password: String, code: String?) = gvm.confirm(password, code)
                override fun cancelConfirmation() = gvm.cancelConfirmation()
            },
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
