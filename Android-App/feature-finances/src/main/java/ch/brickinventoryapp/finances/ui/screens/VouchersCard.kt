package ch.brickinventoryapp.finances.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Redeem
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.finances.ui.BalanceRun
import ch.brickinventoryapp.finances.ui.VoucherStep
import ch.brickinventoryapp.finances.ui.VoucherUiState
import ch.brickinventoryapp.finances.ui.voucherSum
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.step.StepAction
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.LabelAndValue
import ch.brickinventoryapp.ui.components.LocalStepGuard
import ch.brickinventoryapp.ui.components.PasswordPrompt
import ch.brickinventoryapp.ui.components.SecretCopyWarning
import ch.brickinventoryapp.ui.components.SettingsCard
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.fmtMoney

/**
 * Vouchers — LEGO gift cards in one's own profile, reachable as simply as possible
 * and as in the web app's profile. A file of its own, so that SettingsScreen.kt
 * stays manageable.
 */
@Composable
fun VouchersCard(
    condition: VoucherUiState,
    onField: (number: String?, pin: String?, amount: String?, currency: String?) -> Unit,
    switchOnPin: (Int) -> Unit,
    editOn: (Int) -> Unit,
    onCancel: () -> Unit,
    onSave: (android.net.Uri?) -> Unit,
    deleteOn: (Int) -> Unit,
    openOnPdf: (id: Int) -> Unit,
    /** Puts this voucher's number or PIN on the clipboard; needs the plain text. */
    onCopy: (id: Int, isNumber: Boolean) -> Unit,
    /**
     * Query this card's balance at LEGO and save it. The server allows
     * one query every 30 seconds across all users; the run across all cards therefore
     * paces itself.
     */
    onBalance: (Int) -> Unit,
    /** Den laufenden Durchgang anhalten. */
    cancelOnBalance: () -> Unit,
    /** Fetch the list anew after a load error. */
    onAgain: () -> Unit,
    /** Password and code of the open prompt ([VoucherUiState.confirmation]). */
    onConfirm: (password: String, code: String?) -> Unit,
    cancelOnConfirmation: () -> Unit,
    /** Whether the create form is open; its button sits on the page (VouchersPage). */
    newValue: Boolean = false,
    onNew: (Boolean) -> Unit = {},
) {
    // The chosen file lives only in the form — a Uri is a permission of this
    // screen, not a datum of the account. rememberSaveable, because it is a choice made by
    // the person and should survive a rotation; Uri is Parcelable.
    var pdfUri by rememberSaveable { mutableStateOf<android.net.Uri?>(null) }
    val selection = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> pdfUri = uri }
    val guarded = protectedStep()
    // The form sits in a sheet, not permanently under the list: on the
    // phone it otherwise got in the way on every visit. Open for creating ([newValue]) or
    // for as long as a voucher is being edited; after a successful save (fields
    // empty) it closes on its own, on a rejection it stays open with the input.
    var sent by rememberSaveable { mutableStateOf(false) }
    // Tied to the fields, not only to saving: a fast server
    // flips true → false without a composition in between.
    LaunchedEffect(sent, condition.save.running, condition.number, condition.edited) {
        if (sent && !condition.save.running) {
            sent = false
            if (condition.number.isEmpty() && condition.edited == null) onNew(false)
        }
    }
    // Without a header: the card stands alone on its page, whose bar already names „Gutscheine“.
    SettingsCard(title = null, icon = Icons.Default.Redeem) {
      BoxWithConstraints {
        // From tablet width on, two cards side by side: a voucher card over 1000 dp
        // pulled number and menu far apart.
        val wide = maxWidth >= 720.dp
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
        // Adding floats as the main action above the page, balance and PDF sit in the bar's
        // menu (VoucherMenu): three wide buttons stacked pushed the cards
        // out of view. The balance query's progress stays here: with a query
        // every 30 seconds, four cards take a good minute and a half.
        condition.balanceRun?.let { BalanceRunRow(it, cancelOnBalance) }
        EmptyOrError(condition, onAgain)

        val card: @Composable (VoucherView, Modifier) -> Unit = { g, m ->
            VoucherCard(
                g = g,
                pinVisible = g.id in condition.pinVisible,
                // Hiding needs no confirmation, revealing does.
                switchOnPin = {
                    if (g.id in condition.pinVisible) switchOnPin(g.id) else guarded { switchOnPin(g.id) }
                },
                editOn = { guarded { editOn(g.id) } },
                deleteOn = { guarded { deleteOn(g.id) } },
                openOnPdf = { guarded { openOnPdf(g.id) } },
                onCopy = { isNumber -> guarded { onCopy(g.id, isNumber) } },
                plaintext = condition.plaintext[g.id],
                onBalance = { onBalance(g.id) },
                balanceRunning = condition.balanceRunning == g.id,
                modifier = m,
            )
        }
        VoucherRaster(condition.vouchers, wide, card)
        if (condition.vouchers.isNotEmpty()) SecretCopyWarning()

        // The sum — only for a SINGLE currency (voucherSum).
        val sum = voucherSum(condition.vouchers)
        if (sum != null) {
            HorizontalDivider(Modifier.padding(vertical = Spacing.small))
            LabelAndValue(stringResource(R.string.vouchers_total), fmtMoney(sum.first.toDouble(), sum.second),
                valueWeight = FontWeight.Bold)
        }
        }
      }
    }

    condition.confirmation?.let { VoucherPrompt(condition, onConfirm, cancelOnConfirmation) }

    if (newValue || condition.edited != null) {
        VoucherFormSheet(
            condition = condition,
            pdfSelected = pdfUri != null,
            onField = onField,
            onPdfChoose = { selection.launch(arrayOf("application/pdf")) },
            onSave = { sent = true; onSave(pdfUri); pdfUri = null },
            onClose = { onNew(false); pdfUri = null; if (condition.edited != null) onCancel() },
        )
    }
}

/**
 * Number and PIN, the PDFs and delete: only after the device lock (step guard),
 * after that the ViewModel asks for password and code.
 */
@Composable
private fun protectedStep(): (() -> Unit) -> Unit {
    val protection = LocalStepGuard.current
    val reason = stringResource(R.string.step_voucher)
    return { step -> protection.confirm(reason, StepAction.VOUCHER, step) }
}

/** The cards one below the other; from tablet width ([wide]) two of equal height side by side. */
@Composable
private fun VoucherRaster(
    vouchers: List<VoucherView>,
    wide: Boolean,
    card: @Composable (VoucherView, Modifier) -> Unit,
) {
    if (!wide) {
        vouchers.forEach { card(it, Modifier.fillMaxWidth()) }
        return
    }
    vouchers.chunked(2).forEach { pair ->
        Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
            pair.forEach { card(it, Modifier.weight(1f).fillMaxHeight()) }
            if (pair.size == 1) Spacer(Modifier.weight(1f))
        }
    }
}

/**
 * How far the balance query for all cards has got, with cancel: with one query every
 * 30 seconds, four cards take a good minute and a half.
 */
@Composable
private fun BalanceRunRow(jobRun: BalanceRun, onCancel: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        Text(
            if (jobRun.waitSec > 0) {
                stringResource(R.string.vouchers_balance_wait, jobRun.waitSec.toString(), jobRun.number)
            } else {
                stringResource(R.string.vouchers_balance_progress,
                    (jobRun.done + 1).toString(), jobRun.total.toString(), jobRun.number)
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onCancel) { Text(stringResource(R.string.common_cancel)) }
    }
}

/**
 * Without vouchers: the load error with its class's advice and a retry, otherwise the
 * empty state like every list (icon, title, what the page is for). No button of its own
 * for a bulk import: the file goes through the field in the form.
 */
@Composable
private fun EmptyOrError(condition: VoucherUiState, onAgain: () -> Unit) {
    if (condition.vouchers.isNotEmpty() || condition.fetch.loading) return
    val error = condition.fetch as? Load.Failure
    if (error != null) ErrorHint(error.message.sentence(), onAgain, error.kind)
    else Column(Modifier.fillMaxWidth().padding(vertical = Spacing.medium),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
        HintText(Icons.Default.Redeem, stringResource(R.string.vouchers_empty),
            stringResource(R.string.vouchers_empty_hint))
    }
}

/** Password and code before deleting, a PDF or plain text ([VoucherUiState.confirmation]). */
@Composable
private fun VoucherPrompt(
    condition: VoucherUiState,
    onConfirm: (password: String, code: String?) -> Unit,
    onCancel: () -> Unit,
) {
    val question = condition.confirmation ?: return
    val number = condition.vouchers.find { it.id == question.id }?.number.orEmpty()
    val delete = question.step == VoucherStep.DELETE
    val pdf = question.step == VoucherStep.PDF || question.step == VoucherStep.EXPORT
    PasswordPrompt(
        title = stringResource(if (delete) R.string.vouchers_delete_title else R.string.vouchers_confirm_title),
        text = when {
            delete -> stringResource(R.string.vouchers_delete_confirm, number)
            pdf -> stringResource(R.string.vouchers_confirm_pdf)
            else -> stringResource(R.string.vouchers_confirm_plaintext)
        },
        confirm = stringResource(if (delete) R.string.common_delete else R.string.vouchers_confirm_button),
        codeNeeded = question.codeNeeded,
        error = question.operation.errorMessage?.sentence(),
        running = question.operation.running,
        onConfirm = onConfirm,
        onCancel = onCancel,
    )
}

/**
 * The page's main action: add a voucher. The version with content, not the one with
 * `text`/`icon`: that one takes the text from the semantics, which would read out only „Schaltfläche“.
 */
@Composable
internal fun VoucherAdd(onClick: () -> Unit) {
    ExtendedFloatingActionButton(onClick = onClick) {
        Icon(Icons.Default.Add, null)
        Spacer(Modifier.width(Spacing.medium))
        Text(stringResource(R.string.vouchers_add))
    }
}

/**
 * What applies to all vouchers, in the bar's menu: query the balance of all cards
 * (one after another) and all of them as ONE PDF in the viewer. Both rare, so
 * not as a button above the list.
 */
@Composable
internal fun VoucherMenu(condition: VoucherUiState, onBalanceAll: () -> Unit, exportOn: () -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    val guarded = protectedStep()
    val description = stringResource(R.string.vouchers_menu_cd)
    Box {
        WithTooltip(description) {
            IconButton(onClick = { open = true }) { Icon(Icons.Default.MoreVert, description) }
        }
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.vouchers_balance_all)) },
                leadingIcon = { Icon(Icons.Default.Sync, null) },
                // A balance can only be queried with a PIN; if a query is already running, it waits.
                enabled = condition.balanceRun == null && condition.vouchers.any { !it.pin.isNullOrBlank() },
                onClick = { open = false; onBalanceAll() },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.vouchers_export)) },
                leadingIcon = { Icon(Icons.Default.PictureAsPdf, null) },
                // Without vouchers out: the server answered with 404, a viewer with
                // an error message would be the most roundabout way to say „du hast noch keine“.
                enabled = condition.vouchers.isNotEmpty(),
                onClick = { open = false; guarded(exportOn) },
            )
        }
    }
}
