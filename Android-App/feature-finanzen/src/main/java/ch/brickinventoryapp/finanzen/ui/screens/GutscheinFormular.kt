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

/** Das Formular zum Anlegen und Ändern als Blatt von unten. */
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
    ModalBottomSheet(onDismissRequest = onSchliessen) {
      Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
            .padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.sehrGross),
        verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
      ) {
        Text(
            stringResource(if (zustand.bearbeitet != null) R.string.vouchers_edit else R.string.vouchers_add),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )

        // Filter UND Tastatur gehoeren zusammen — die Tastaturwahl ist eine
        // Bitte an die Tastatur-App, keine Zusicherung: Eine angestoepselte
        // Tastatur und die Zwischenablage liefern trotzdem Buchstaben. Die
        // Regel steht in ZahlentastaturTest, der Filter in NumericInput.kt.
        val nummerMaske = istMaskierteNummer(zustand.nummer)
        OutlinedTextField(
            shape = Formen.feld,
            value = zustand.nummer,
            onValueChange = {
                onFeld(NumericInput.quantity(eingabeUeberMaske(zustand.nummer, it, nummerMaske)), null, null, null)
            },
            label = { Text(stringResource(R.string.vouchers_number)) },
            supportingText = if (nummerMaske) { { Text(stringResource(R.string.vouchers_mask_hint)) } } else null,
            singleLine = true,
            keyboardOptions = NumericInput.ganzzahlTastatur(),
            modifier = Modifier.fillMaxWidth(),
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
                isError = NumericInput.preisUngueltig(zustand.betrag),
                supportingText = {
                    if (NumericInput.preisUngueltig(zustand.betrag)) Text(stringResource(R.string.erfassen_preis_ungueltig), Modifier.ansagen())
                },
                singleLine = true,
                // price/preisTastatur und nicht ganzzahl: Ein Gutschein kann
                // auf Rappen lauten. `price` laesst GENAU EIN Trennzeichen zu
                // — „12.3.4" waere sonst tippbar und floege erst beim
                // Umwandeln auf, dann als stiller Nullbetrag.
                keyboardOptions = NumericInput.preisTastatur(),
                modifier = Modifier.weight(1f),
            )
        }

        WaehrungsWahl(zustand.waehrung) { onFeld(null, null, null, it) }

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

        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = onSpeichern, enabled = !zustand.speichert) { Text(stringResource(R.string.settings_save)) }
            TextButton(onClick = onSchliessen) { Text(stringResource(R.string.common_cancel)) }
            if (zustand.speichert) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            }
        }
      }
    }
}

/** Dieselben Waehrungen wie in der Webapp (public/index.html). */
private val WAEHRUNGEN = listOf("CHF", "EUR", "USD", "GBP", "SEK", "NOK", "AUD", "CAD", "DKK")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WaehrungsWahl(gewaehlt: String, onWahl: (String) -> Unit) {
    var offen by rememberSaveable { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = offen, onExpandedChange = { offen = it }) {
        OutlinedTextField(
            shape = Formen.feld,
            value = gewaehlt,
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.settings_currency)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = offen) },
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, true).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = offen, onDismissRequest = { offen = false }) {
            for (w in WAEHRUNGEN) {
                DropdownMenuItem(text = { Text(w) }, onClick = { onWahl(w); offen = false })
            }
        }
    }
}
