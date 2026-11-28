package ch.brickinventoryapp.finances.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.finances.ui.VoucherUiState
import ch.brickinventoryapp.finances.ui.viewmodel.inputViaMask
import ch.brickinventoryapp.model.domain.PIN_MASK_DISPLAY
import ch.brickinventoryapp.model.domain.isMaskedNumber
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.ButtonRow
import ch.brickinventoryapp.ui.components.SelectionField
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.uistate.running

/**
 * The form for creating and editing as a sheet from the bottom, right away fully open: half open
 * the buttons sat beneath the edge. The fields scroll, the buttons stay fixed at the bottom
 * above the keyboard.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun VoucherFormSheet(
    condition: VoucherUiState,
    pdfSelected: Boolean,
    onField: (number: String?, pin: String?, amount: String?, currency: String?) -> Unit,
    onPdfChoose: () -> Unit,
    onSave: () -> Unit,
    onClose: () -> Unit,
) {
    // Save stays tappable and then marks what is missing, as with the set dialog.
    var checked by rememberSaveable { mutableStateOf(false) }
    val error = if (checked) voucherError(condition.number, condition.amount, pdfSelected) else emptyList()
    val numberMissing = VoucherField.NUMBER in error
    val amountMissing = VoucherField.AMOUNT in error
    val numberFocus = remember { FocusRequester() }
    val amountFocus = remember { FocusRequester() }
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberBottomSheetState(
        initialValue = SheetValue.Hidden, enabledValues = setOf(SheetValue.Hidden, SheetValue.Expanded))) {
      Column(Modifier.fillMaxWidth().imePadding()) {
      Column(
        Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState())
            .padding(horizontal = Spacing.large),
        verticalArrangement = Arrangement.spacedBy(Spacing.small),
      ) {
        Text(
            stringResource(if (condition.edited != null) R.string.vouchers_edit else R.string.vouchers_add),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )

        VoucherNumberField(condition, numberMissing, numberFocus, onField)

        PinAndAmount(condition, amountMissing, amountFocus, onField)

        SelectionField(stringResource(R.string.settings_currency), CURRENCIES.map { it to it }, condition.currency,
            { onField(null, null, null, it) }, Modifier.fillMaxWidth())

        // Only when creating: a voucher gets its PDF once.
        if (condition.edited == null) PdfChoice(pdfSelected, onPdfChoose)
      }
        HorizontalDivider(Modifier.padding(top = Spacing.small))
        ButtonRow(
            confirm = stringResource(R.string.settings_save),
            onConfirm = {
                checked = true
                when (voucherError(condition.number, condition.amount, pdfSelected).firstOrNull()) {
                    VoucherField.NUMBER -> numberFocus.focusIfPresent()
                    VoucherField.AMOUNT -> amountFocus.focusIfPresent()
                    null -> onSave()
                }
            },
            onCancel = onClose,
            running = condition.save.running,
            modifier = Modifier.padding(horizontal = Spacing.large, vertical = Spacing.medium),
        )
      }
    }
}

/** A field of the voucher form that is missing or unreadable before saving. */
internal enum class VoucherField { NUMBER, AMOUNT }

/**
 * What is missing before saving, in field order. With a PDF, the server reads
 * what is empty; an unreadable amount stays an error regardless.
 */
internal fun voucherError(number: String, amount: String, withPdf: Boolean): List<VoucherField> = buildList {
    if (!withPdf && number.isBlank()) add(VoucherField.NUMBER)
    val unreadable = amount.replace(',', '.').trim().toDoubleOrNull() == null
    if (if (withPdf) amount.isNotBlank() && unreadable else unreadable) add(VoucherField.AMOUNT)
}

/** If the sheet is already closed, requestFocus throws; then there is nothing left to focus. */
private fun FocusRequester.focusIfPresent() {
    try { requestFocus() } catch (_: IllegalStateException) { /* sheet already closed */ }
}

/** The same currencies as in the web app (public/index.html). */
private val CURRENCIES = listOf("CHF", "EUR", "USD", "GBP", "SEK", "NOK", "AUD", "CAD", "DKK")

/** The voucher number; masked by the server until it is typed anew. */
@Composable
private fun VoucherNumberField(
    condition: VoucherUiState,
    numberMissing: Boolean,
    numberFocus: FocusRequester,
    onField: (number: String?, pin: String?, amount: String?, currency: String?) -> Unit,
) {
    val numberMask = isMaskedNumber(condition.number)
    OutlinedTextField(
        shape = Shapes.field,
        value = condition.number,
        onValueChange = {
            onField(NumericInput.quantity(inputViaMask(condition.number, it, numberMask)), null, null, null)
        },
        label = { Text(stringResource(R.string.vouchers_number)) },
        isError = numberMissing,
        supportingText = when {
            numberMissing -> { { Text(stringResource(R.string.vouchers_number_missing), Modifier.announce()) } }
            numberMask -> { { Text(stringResource(R.string.vouchers_mask_hint)) } }
            else -> null
        },
        singleLine = true,
        keyboardOptions = NumericInput.integerKeyboard(),
        modifier = Modifier.fillMaxWidth().focusRequester(numberFocus),
    )
}

/** PIN and amount side by side; the amount marks itself when missing or unreadable. */
@Composable
private fun PinAndAmount(
    condition: VoucherUiState,
    amountMissing: Boolean,
    amountFocus: FocusRequester,
    onField: (number: String?, pin: String?, amount: String?, currency: String?) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
        val pinMask = condition.pin == PIN_MASK_DISPLAY
        OutlinedTextField(
            shape = Shapes.field,
            value = condition.pin,
            onValueChange = { onField(null, NumericInput.quantity(inputViaMask(condition.pin, it, pinMask)), null, null) },
            label = { Text(stringResource(R.string.vouchers_pin)) },
            singleLine = true,
            keyboardOptions = NumericInput.integerKeyboard(),
            modifier = Modifier.weight(1f),
        )
        OutlinedTextField(
            shape = Shapes.field,
            value = condition.amount,
            onValueChange = { onField(null, null, NumericInput.price(it), null) },
            label = { Text(stringResource(R.string.vouchers_amount)) },
            // The same check as for the gallery's price fields; whether the amount is mandatory
            // and how high it may be is decided solely by the server.
            isError = amountMissing || NumericInput.priceInvalid(condition.amount),
            supportingText = {
                if (NumericInput.priceInvalid(condition.amount)) Text(stringResource(R.string.record_price_invalid), Modifier.announce())
                else if (amountMissing) Text(stringResource(R.string.vouchers_amount_invalid), Modifier.announce())
            },
            singleLine = true,
            // price/priceKeyboard and not an integer: a voucher can
            // be denominated in cents. `price` allows EXACTLY ONE separator
            // — „12.3.4" would otherwise be typeable and would only surface
            // on conversion, and then as a silent zero amount.
            keyboardOptions = NumericInput.priceKeyboard(),
            modifier = Modifier.weight(1f).focusRequester(amountFocus),
        )
    }
}

/** Choose the voucher's PDF, with what was chosen and what the PDF is for. */
@Composable
private fun PdfChoice(pdfSelected: Boolean, onPdfChoose: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
        OutlinedButton(onClick = onPdfChoose, colors = secondaryButtonColors(), border = secondaryButtonRand()) {
            Icon(Icons.Default.UploadFile, null, Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Spacing.small))
            Text(stringResource(R.string.vouchers_pick_pdf))
        }
        if (pdfSelected) {
            Text(
                stringResource(R.string.vouchers_pdf_chosen),
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
    Text(
        stringResource(R.string.vouchers_pdf_hint),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
