package ch.brickinventoryapp.collection.ui.screens

import ch.brickinventoryapp.model.domain.Zustand
import androidx.compose.runtime.LaunchedEffect
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.MemberView
import androidx.compose.foundation.layout.*
import ch.brickinventoryapp.ui.components.announce
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.shared.ui.LagerortErfassung
import ch.brickinventoryapp.shared.ui.OwnerPicker
import ch.brickinventoryapp.shared.ui.Zustandszeile

/**
 * Quantity, purchase price and condition before taking over — no default is
 * reliably right for a set just bought. The same fields in the same order
 * as in the catalog dialog. The condition is pre-filled with the watchlist item's;
 * which watchlist item is fulfilled is decided by the server.
 */
@Composable
internal fun UebernahmeDialog(
    merkposten: WantedItemView,
    /** Stock of storage locations — empty means: there are none yet, then it's typed in. */
    lagerorte: List<String> = emptyList(),
    /** The preselected storage location (star in settings). Empty means: no default. */
    locationDefault: String = "",
    onDismiss: () -> Unit,
    onUebernehmen: (Int, String, Zustand, String?) -> Unit,
) {
    var anzahl   by rememberSaveable { mutableStateOf("1") }
    var preis    by rememberSaveable { mutableStateOf("") }
    var zustand  by rememberSaveable { mutableStateOf(merkposten.condition) }
    // Key is the default — the same reasoning as in the catalog dialog.
    var lagerort by rememberSaveable(locationDefault) { mutableStateOf(locationDefault) }

    AddDialog(
        titel = stringResource(R.string.wanted_take),
        bestaetigen = stringResource(R.string.wanted_take),
        onBestaetigen = { onUebernehmen(anzahl.toIntOrNull() ?: 1, preis, zustand,
                                        lagerort.trim().takeIf { it.isNotEmpty() }) },
        onAbbrechen = onDismiss,
        geaendert = anzahl != "1" || preis.isNotEmpty() || zustand != merkposten.condition || lagerort != locationDefault,
    ) {
        Text(merkposten.name ?: merkposten.setNumber, style = MaterialTheme.typography.bodyMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            // NumericInput instead of its own filtering: the rule for what counts as a number (exactly one
            // separator) lives once in util/NumericInput.kt.
            OutlinedTextField(
                shape = Formen.feld,
                value = anzahl,
                onValueChange = { anzahl = NumericInput.quantity(it) },
                label = { Text(stringResource(R.string.common_quantity)) },
                singleLine = true,
                keyboardOptions = NumericInput.ganzzahlTastatur(),
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                shape = Formen.feld,
                value = preis,
                onValueChange = { preis = NumericInput.price(it) },
                label = { Text(stringResource(R.string.gallery_purchase_price)) },
                singleLine = true,
                keyboardOptions = NumericInput.priceKeyboard(),
                modifier = Modifier.weight(1f),
            )
        }
        // Labeled "Condition": two chips with no heading didn't say what they ask about.
        Zustandszeile(zustand, { zustand = it })
        // Storage location as with every other entry.
        LagerortErfassung(lagerort, lagerorte, { lagerort = it })
    }
}

/**
 * The entry mask as a dialog, like AddSetDialog in the gallery — a card
 * would cost room on every screen. Number, condition, account; quantity and purchase price
 * only on taking over, a watchlist item has neither. The cursor goes into the
 * number field right away; the short pause before it is needed because the field isn't
 * laid out yet on the first pass.
 */
@Composable
internal fun WantedItemAddDialog(
    householdMembers: List<MemberView>,
    defaultCondition: Zustand,
    onDismiss: () -> Unit,
    createOn: (String, Zustand, Int?) -> Unit,
) {
    var nummer  by rememberSaveable { mutableStateOf("") }
    var zustand by rememberSaveable { mutableStateOf(defaultCondition) }
    // Pre-filled with one's own account — whoever chooses nothing wants it for themself.
    var besitzer by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }

    // "Add to watchlist" stays tappable and then marks the empty field: gray with no
    // reason left you guessing why nothing happened.
    var numberMissing by rememberSaveable { mutableStateOf(false) }
    val numberFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(120)
        try { numberFocus.requestFocus() } catch (_: Exception) { /* dialog already closed */ }
    }

    AddDialog(
        titel = stringResource(R.string.wanted_add_title),
        bestaetigen = stringResource(R.string.wanted_add_submit),
        // Only send if there was a choice at all — otherwise the
        // server writes to one's own account.
        onBestaetigen = {
            if (nummer.isBlank()) numberMissing = true
            else createOn(nummer, zustand, if (householdMembers.size > 1) besitzer else null)
        },
        onAbbrechen = onDismiss,
        geaendert = nummer.isNotBlank() || zustand != defaultCondition,
    ) {
        OutlinedTextField(
            value = nummer,
            onValueChange = { nummer = NumericInput.setNumber(it) },
            label = { Text(stringResource(R.string.gallery_set_number)) },
            // As help text instead of a placeholder: the placeholder disappeared with
            // focus, and the dialog focuses the field right away.
            isError = numberMissing && nummer.isBlank(),
            supportingText = {
                if (numberMissing && nummer.isBlank()) Text(stringResource(R.string.erfassen_nummer_fehlt), Modifier.announce())
                else Text(stringResource(R.string.gallery_set_number_placeholder))
            },
            singleLine = true,
            shape = Formen.feld,
            // The same keyboard as in AddSetDialog. A number field
            // without a keyboard choice opens the letter keyboard — the
            // rule for that lives in NumericInputTest.
            keyboardOptions = NumericInput.setNumberKeyboard(),
            modifier = Modifier.fillMaxWidth().focusRequester(numberFocus),
        )
        // Labeled "Condition": two chips with no heading didn't say what they ask about.
        Zustandszeile(zustand, { zustand = it })
        // The same picker as when entering a set. On a
        // single account it hides itself (members.size < 2).
        OwnerPicker(householdMembers, besitzer, { besitzer = it })
    }
}
