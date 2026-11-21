package ch.brickinventoryapp.shared.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Formen

/**
 * The storage-location field: choose or type a new one, in one control — an
 * ExposedDropdownMenuBox opens like a dropdown and still accepts
 * typed input, the counterpart to the web app's `datalist`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LocationField(
    wert: String,
    stock: List<String>,
    onValue: (String) -> Unit,
    modifier: Modifier = Modifier,
    /**
     * What sits in the empty field. In the detail views „Kein Lagerort“ — an example
     * like „z. B. Kiste 3“ in the choice frame read there like a set location; the
     * example only appears during capture (LagerortErfassung).
     */
    platzhalter: String = stringResource(R.string.detail_storage_none),
    /** Label in the field; with it, the example sits as help text below it instead of as a placeholder. */
    beschriftung: String? = null,
) {
    // Schluessel is the value from outside: if a different one arrives (a different set, or
    // the normalized value after saving), the field should show it
    // instead of keeping the old text.
    var text by rememberSaveable(wert) { mutableStateOf(wert) }
    // rememberSaveable, not remember: whoever rotates the phone while choosing a
    // location should still see the list open. That it only
    // appears when there are matching locations makes this harmless.
    var offen by rememberSaveable { mutableStateOf(false) }
    // What's available to choose while typing: only the matching ones. With
    // thirty shelves, an unfiltered list is no longer a help.
    val passend = stock.filter { it.contains(text.trim(), ignoreCase = true) }

    ExposedDropdownMenuBox(
        expanded = offen && passend.isNotEmpty(),
        onExpandedChange = { offen = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            shape = Formen.feld,
            value = text,
            onValueChange = {
                if (it.length <= 60) { text = it; offen = true; onValue(it) }
            },
            singleLine = true,
            label = beschriftung?.let { { Text(it) } },
            placeholder = if (beschriftung == null) {
                // Field text like any input field: smaller than the label next to it,
                // „Kein Lagerort“ looked like a footnote.
                { Text(platzhalter, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            } else null,
            supportingText = beschriftung?.let { { Text(platzhalter) } },
            trailingIcon = {
                ExposedDropdownMenuDefaults.TrailingIcon(expanded = offen)
            },
            // As wide as the caller dictates: without a width the field stuck at Materials'
            // 280 dp — narrower than the others in the dialog, half as wide in the detail.
            modifier = Modifier.menuAnchor(
                ExposedDropdownMenuAnchorType.PrimaryEditable, true)
                .fillMaxWidth(),
        )
        ExposedDropdownMenu(
            expanded = offen && passend.isNotEmpty(),
            onDismissRequest = { offen = false },
        ) {
            for (ort in passend) {
                DropdownMenuItem(
                    text = { Text(ort, style = MaterialTheme.typography.labelLarge) },
                    onClick = { text = ort; offen = false; onValue(ort) },
                )
            }
        }
    }
}

/**
 * The same field in the capture dialog: label in the field and full width like the
 * fields above it, so the storage location can be set already during capture — in
 * gallery, barcode, catalog, wishlist and for manual parts and figures. In the
 * detail views the field sits narrow next to its label.
 */
@Composable
fun LagerortErfassung(
    wert: String,
    stock: List<String>,
    onValue: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // A hint for every capture, with and without stock: two different strings for the same field
    // would make the dialogs look different.
    LocationField(wert = wert, stock = stock, onValue = onValue,
                 modifier = modifier.fillMaxWidth(), platzhalter = stringResource(R.string.detail_storage_ph),
                 beschriftung = stringResource(R.string.detail_storage))
}
