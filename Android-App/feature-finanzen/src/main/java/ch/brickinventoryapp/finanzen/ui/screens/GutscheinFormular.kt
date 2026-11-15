package ch.brickinventoryapp.finanzen.ui.screens

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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.finanzen.ui.GutscheinUiState
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.finanzen.ui.viewmodel.eingabeUeberMaske
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.model.ui.model.PIN_MASKE_ANZEIGE
import ch.brickinventoryapp.model.ui.model.istMaskierteNummer
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.components.AuswahlFeld
import ch.brickinventoryapp.ui.components.Knopfzeile

/**
 * Das Formular zum Anlegen und Ändern als Blatt von unten, gleich ganz offen: Halb offen
 * lagen die Knöpfe unter dem Rand. Die Felder rollen, die Knöpfe stehen fest am Fuss
 * über der Tastatur.
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
    // Speichern bleibt antippbar und markiert dann, was fehlt, wie beim Set-Dialog.
    var geprueft by rememberSaveable { mutableStateOf(false) }
    val fehler = if (geprueft) gutscheinFehler(zustand.nummer, zustand.betrag, pdfGewaehlt) else emptyList()
    val nummerFehlt = GutscheinFeld.NUMMER in fehler
    val betragFehlt = GutscheinFeld.BETRAG in fehler
    val nummerFokus = remember { FocusRequester() }
    val betragFokus = remember { FocusRequester() }
    ModalBottomSheet(onDismissRequest = onSchliessen, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
      Column(Modifier.fillMaxWidth().imePadding()) {
      Column(
        Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState())
            .padding(horizontal = Abstaende.gross),
        verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
      ) {
        Text(
            stringResource(if (zustand.bearbeitet != null) R.string.vouchers_edit else R.string.vouchers_add),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )

        val nummerMaske = istMaskierteNummer(zustand.nummer)
        OutlinedTextField(
            shape = Formen.feld,
            value = zustand.nummer,
            onValueChange = {
                onFeld(NumericInput.quantity(eingabeUeberMaske(zustand.nummer, it, nummerMaske)), null, null, null)
            },
            label = { Text(stringResource(R.string.vouchers_number)) },
            isError = nummerFehlt,
            supportingText = when {
                nummerFehlt -> { { Text(stringResource(R.string.vouchers_number_fehlt), Modifier.ansagen()) } }
                nummerMaske -> { { Text(stringResource(R.string.vouchers_mask_hint)) } }
                else -> null
            },
            singleLine = true,
            keyboardOptions = NumericInput.ganzzahlTastatur(),
            modifier = Modifier.fillMaxWidth().focusRequester(nummerFokus),
        )

        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            val pinMaske = zustand.pin == PIN_MASKE_ANZEIGE
            OutlinedTextField(
                shape = Formen.feld,
                value = zustand.pin,
                onValueChange = { onFeld(null, NumericInput.quantity(eingabeUeberMaske(zustand.pin, it, pinMaske)), null, null) },
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
                // Dieselbe Prüfung wie bei den Preisfeldern der Galerie; ob der Betrag Pflicht
                // ist und wie hoch er sein darf, entscheidet allein der Server.
                isError = betragFehlt || NumericInput.preisUngueltig(zustand.betrag),
                supportingText = {
                    if (NumericInput.preisUngueltig(zustand.betrag)) Text(stringResource(R.string.erfassen_preis_ungueltig), Modifier.ansagen())
                    else if (betragFehlt) Text(stringResource(R.string.vouchers_amount_invalid), Modifier.ansagen())
                },
                singleLine = true,
                // price/preisTastatur und nicht ganzzahl: Ein Gutschein kann
                // auf Rappen lauten. `price` laesst GENAU EIN Trennzeichen zu
                // — „12.3.4" waere sonst tippbar und floege erst beim
                // Umwandeln auf, dann als stiller Nullbetrag.
                keyboardOptions = NumericInput.preisTastatur(),
                modifier = Modifier.weight(1f).focusRequester(betragFokus),
            )
        }

        AuswahlFeld(stringResource(R.string.settings_currency), WAEHRUNGEN.map { it to it }, zustand.waehrung,
            { onFeld(null, null, null, it) }, Modifier.fillMaxWidth())

        // ── Der PDF-Weg ──
        //
        // Nur beim Anlegen: Ein Gutschein bekommt sein PDF einmal.
        if (zustand.bearbeitet == null) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                OutlinedButton(onClick = onPdfWaehlen, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                    Icon(Icons.Default.UploadFile, null, Modifier.size(mitSchrift(18.dp)))
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
                when (gutscheinFehler(zustand.nummer, zustand.betrag, pdfGewaehlt).firstOrNull()) {
                    GutscheinFeld.NUMMER -> nummerFokus.fokusWennDa()
                    GutscheinFeld.BETRAG -> betragFokus.fokusWennDa()
                    null -> onSpeichern()
                }
            },
            onAbbrechen = onSchliessen,
            laeuft = zustand.speichert,
            modifier = Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.mittel),
        )
      }
    }
}

/** Ein Feld des Gutscheinformulars, das vor dem Speichern fehlt oder unlesbar ist. */
internal enum class GutscheinFeld { NUMMER, BETRAG }

/**
 * Was vor dem Speichern fehlt, in der Reihenfolge der Felder. Mit PDF liest der Server,
 * was leer ist; ein unlesbarer Betrag bleibt auch dann ein Fehler.
 */
internal fun gutscheinFehler(nummer: String, betrag: String, mitPdf: Boolean): List<GutscheinFeld> = buildList {
    if (!mitPdf && nummer.isBlank()) add(GutscheinFeld.NUMMER)
    val unlesbar = betrag.replace(',', '.').trim().toDoubleOrNull() == null
    if (if (mitPdf) betrag.isNotBlank() && unlesbar else unlesbar) add(GutscheinFeld.BETRAG)
}

/** Ist das Blatt schon zu, wirft requestFocus; dann gibt es nichts mehr zu fokussieren. */
private fun FocusRequester.fokusWennDa() {
    try { requestFocus() } catch (_: IllegalStateException) { /* Blatt schon zu */ }
}

/** Dieselben Waehrungen wie in der Webapp (public/index.html). */
private val WAEHRUNGEN = listOf("CHF", "EUR", "USD", "GBP", "SEK", "NOK", "AUD", "CAD", "DKK")
