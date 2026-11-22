package ch.brickinventoryapp.finances.ui.screens

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.finances.ui.GutscheinUiState
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.finances.ui.viewmodel.inputViaMask
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.model.domain.PIN_MASK_DISPLAY
import ch.brickinventoryapp.model.domain.isMaskedNumber
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.components.SelectionField
import ch.brickinventoryapp.ui.components.Knopfzeile

/**
 * The form for creating and editing as a sheet from the bottom, right away fully open: half open
 * the buttons sat beneath the edge. The fields scroll, the buttons stay fixed at the bottom
 * above the keyboard.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun GutscheinFormularBlatt(
    zustand: GutscheinUiState,
    pdfGewaehlt: Boolean,
    onFeld: (nummer: String?, pin: String?, betrag: String?, waehrung: String?) -> Unit,
    onPdfWaehlen: () -> Unit,
    onSpeichern: () -> Unit,
    onSchliessen: () -> Unit,
) {
    // Save stays tappable and then marks what is missing, as with the set dialog.
    var geprueft by rememberSaveable { mutableStateOf(false) }
    val fehler = if (geprueft) voucherError(zustand.nummer, zustand.betrag, pdfGewaehlt) else emptyList()
    val numberMissing = VoucherField.NUMMER in fehler
    val amountMissing = VoucherField.AMOUNT in fehler
    val numberFocus = remember { FocusRequester() }
    val amountFocus = remember { FocusRequester() }
    ModalBottomSheet(onDismissRequest = onSchliessen, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
      Column(Modifier.fillMaxWidth().imePadding()) {
      Column(
        Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState())
            .padding(horizontal = Abstaende.gross),
        verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
      ) {
        Text(
            stringResource(if (zustand.edited != null) R.string.vouchers_edit else R.string.vouchers_add),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )

        val numberMask = isMaskedNumber(zustand.nummer)
        OutlinedTextField(
            shape = Formen.feld,
            value = zustand.nummer,
            onValueChange = {
                onFeld(NumericInput.quantity(inputViaMask(zustand.nummer, it, numberMask)), null, null, null)
            },
            label = { Text(stringResource(R.string.vouchers_number)) },
            isError = numberMissing,
            supportingText = when {
                numberMissing -> { { Text(stringResource(R.string.vouchers_number_fehlt), Modifier.announce()) } }
                numberMask -> { { Text(stringResource(R.string.vouchers_mask_hint)) } }
                else -> null
            },
            singleLine = true,
            keyboardOptions = NumericInput.ganzzahlTastatur(),
            modifier = Modifier.fillMaxWidth().focusRequester(numberFocus),
        )

        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            val pinMask = zustand.pin == PIN_MASK_DISPLAY
            OutlinedTextField(
                shape = Formen.feld,
                value = zustand.pin,
                onValueChange = { onFeld(null, NumericInput.quantity(inputViaMask(zustand.pin, it, pinMask)), null, null) },
                label = { Text(stringResource(R.string.vouchers_pin)) },
                singleLine = true,
                keyboardOptions = NumericInput.ganzzahlTastatur(),
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                shape = Formen.feld,
                value = zustand.betrag,
                onValueChange = { onFeld(null, null, NumericInput.price(it), null) },
                label = { Text(stringResource(R.string.vouchers_amount)) },
                // The same check as for the gallery's price fields; whether the amount is mandatory
                // and how high it may be is decided solely by the server.
                isError = amountMissing || NumericInput.priceInvalid(zustand.betrag),
                supportingText = {
                    if (NumericInput.priceInvalid(zustand.betrag)) Text(stringResource(R.string.erfassen_preis_ungueltig), Modifier.announce())
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

        SelectionField(stringResource(R.string.settings_currency), CURRENCIES.map { it to it }, zustand.waehrung,
            { onFeld(null, null, null, it) }, Modifier.fillMaxWidth())

        // ── Der PDF-Weg ──
        //
        // Nur beim Anlegen: Ein Gutschein bekommt sein PDF einmal.
        if (zustand.edited == null) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                OutlinedButton(onClick = onPdfWaehlen, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                    Icon(Icons.Default.UploadFile, null, Modifier.size(withFont(18.dp)))
                    Spacer(Modifier.width(Abstaende.klein))
                    Text(stringResource(R.string.vouchers_pick_pdf))
                }
                if (pdfGewaehlt) {
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
      }
        HorizontalDivider(Modifier.padding(top = Abstaende.klein))
        Knopfzeile(
            bestaetigen = stringResource(R.string.settings_save),
            onBestaetigen = {
                geprueft = true
                when (voucherError(zustand.nummer, zustand.betrag, pdfGewaehlt).firstOrNull()) {
                    VoucherField.NUMMER -> numberFocus.focusIfDa()
                    VoucherField.AMOUNT -> amountFocus.focusIfDa()
                    null -> onSpeichern()
                }
            },
            onAbbrechen = onSchliessen,
            laeuft = zustand.speichern.laeuft,
            modifier = Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.mittel),
        )
      }
    }
}

/** A field of the voucher form that is missing or unreadable before saving. */
internal enum class VoucherField { NUMMER, AMOUNT }

/**
 * What is missing before saving, in field order. With a PDF, the server reads
 * what is empty; an unreadable amount stays an error regardless.
 */
internal fun voucherError(nummer: String, betrag: String, withPdf: Boolean): List<VoucherField> = buildList {
    if (!withPdf && nummer.isBlank()) add(VoucherField.NUMMER)
    val unlesbar = betrag.replace(',', '.').trim().toDoubleOrNull() == null
    if (if (withPdf) betrag.isNotBlank() && unlesbar else unlesbar) add(VoucherField.AMOUNT)
}

/** If the sheet is already closed, requestFocus throws; then there is nothing left to focus. */
private fun FocusRequester.focusIfDa() {
    try { requestFocus() } catch (_: IllegalStateException) { /* sheet already closed */ }
}

/** The same currencies as in the web app (public/index.html). */
private val CURRENCIES = listOf("CHF", "EUR", "USD", "GBP", "SEK", "NOK", "AUD", "CAD", "DKK")
