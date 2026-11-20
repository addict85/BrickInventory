package ch.brickinventoryapp.collection.ui.screens

import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.titel
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.shared.ui.CountField
import ch.brickinventoryapp.shared.ui.PurchasePriceField
import ch.brickinventoryapp.shared.ui.LagerortErfassung
import ch.brickinventoryapp.shared.ui.OwnerPicker
import ch.brickinventoryapp.shared.ui.Zustandszeile
import ch.brickinventoryapp.shared.ui.entryInvalid

/**
 * Ein Set erfassen. Zur Wahl steht der VORRAT an Lagerorten, nicht die belegten:
 * Die Filterliste enthält nur, worin schon etwas liegt; beim Erfassen soll auch
 * ein leeres Regal zur Wahl stehen.
 */
@Composable
internal fun GalerieErfassen(zustand: GalleryState, events: GalleryEvents, onSchliessen: () -> Unit) {
    AddSetDialog(
        onDismiss = onSchliessen,
        onAdd = { wish -> onSchliessen(); events.setErfassen(wish) },
        householdMembers = zustand.blick.householdMembers,
        defaultCondition = zustand.app.userDefaultCondition ?: Zustand.NEU,
        lagerorte = zustand.lager.eigene.map { it.name },
        vorgabe = zustand.lager.vorgabe?.name ?: "",
    )
}

/** Ohne Haushalt gar nichts mitschicken — der Server bleibt dann beim eigenen Konto. */
private fun ownerForEntry(mitglieder: List<MemberView>, gewaehlt: Int?): Int? =
    if (mitglieder.size > 1) gewaehlt else null

/** Ist der Dialog schon zu, wirft requestFocus; dann gibt es nichts mehr zu fokussieren. */
private fun FocusRequester.openFocusIf() {
    try { requestFocus() } catch (_: Exception) { /* Dialog schon zu */ }
}

@Composable
private fun FocusAfterPause(ziel: FocusRequester) = LaunchedEffect(Unit) {
    kotlinx.coroutines.delay(120)
    ziel.openFocusIf()
}

/**
 * Der Hinweis am Setnummer-Feld (null: nichts zu beanstanden). Vor dem ersten Versuch zu
 * erfassen bleibt das Feld ruhig, damit "75192-" beim Tippen nicht schon als Fehler gilt.
 */
private fun numberError(nummer: String, geprueft: Boolean): Int? = when {
    !geprueft -> null
    nummer.isBlank() -> R.string.erfassen_nummer_fehlt
    !NumericInput.isSetNumber(nummer) -> R.string.erfassen_nummer_ungueltig
    else -> null
}

@Composable
fun AddSetDialog(
    onDismiss: () -> Unit,
    onAdd: (Erfassungswunsch) -> Unit,
    defaultCondition: Zustand = Zustand.NEU,
    /** Konten des Haushalts — ohne Unterkonten bleibt die Auswahl verborgen. */
    householdMembers: List<MemberView> = emptyList(),
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String> = emptyList(),
    /**
     * Der Ort, der schon dastehen soll (der Stern aus den Einstellungen); leer heisst
     * keine Vorgabe.
     */
    vorgabe: String = "",
    /** Nur Tests: Ein blinkender Cursor lässt Robolectric nie zur Ruhe kommen. */
    immediatelyFocus: Boolean = true,
) {
    var setNumber by rememberSaveable { mutableStateOf("") }
    var quantity  by rememberSaveable { mutableStateOf("1") }
    // Schlüssel ist die Vorgabe: Kommt sie erst nach dem Öffnen des Dialogs, übernimmt
    // das Feld sie; was jemand inzwischen getippt hat, bleibt, weil sich die Vorgabe
    // nur einmal ändert.
    var lagerort  by rememberSaveable(vorgabe) { mutableStateOf(vorgabe) }

    // ── Der Cursor steht sofort im Set-Feld ──
    //
    // LaunchedEffect(Unit) läuft einmal je Anzeige; die kurze Pause davor braucht es,
    // weil das Feld beim ersten Durchlauf noch nicht angeordnet ist und requestFocus()
    // sonst ins Leere liefe.
    val setFeldFokus = remember { FocusRequester() }
    if (immediatelyFocus) FocusAfterPause(setFeldFokus)
    var purchasePrice by rememberSaveable { mutableStateOf("") }
    var condition by rememberSaveable { mutableStateOf(defaultCondition) }
    // Vorbelegt mit dem eigenen Konto: Wer nichts wählt, erfasst für sich —
    // dasselbe Verhalten wie vor der Haushaltssicht.
    var owner by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }
    val keyboard  = LocalSoftwareKeyboardController.current
    // Hinzufügen bleibt antippbar und markiert dann das leere Feld: Grau ohne Grund liess
    // raten, warum nichts geschah.
    var numberMissing by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        if (numberError(setNumber, geprueft = true) != null) {
            numberMissing = true
            if (immediatelyFocus) setFeldFokus.openFocusIf()
        } else if (!entryInvalid(quantity, purchasePrice)) {
            // Bei unlesbarer Menge oder unlesbarem Preis bleibt der Dialog offen; die Felder zeigen den Fehler.
            onAdd(Erfassungswunsch(
                setNumber = setNumber,
                menge = quantity.toIntOrNull() ?: 1,
                kaufpreis = NumericInput.readMoney(purchasePrice),
                zustand = condition,
                besitzer = ownerForEntry(householdMembers, owner),
                lagerort = lagerort.trim().takeIf { it.isNotEmpty() },
            ))
        }
    }

    // Derselbe Rahmen wie jede Erfassung (AddDialog): Titel links, ohne Symbol.
    AddDialog(
        titel = stringResource(R.string.gallery_add_set_title),
        bestaetigen = stringResource(R.string.gallery_add),
        onBestaetigen = { submit() },
        onAbbrechen = onDismiss,
        geaendert = setNumber.isNotBlank() || quantity != "1" || purchasePrice.isNotEmpty() ||
            condition != defaultCondition || lagerort != vorgabe,
        // Ohne eigene Zeile „Bitte Set-Nummer eingeben“: Dreimal derselbe Hinweis schob bei
        // 200 % die Knöpfe aus dem Bild; was fehlt, sagt das Feld erst beim Tippen.
    ) {
        OwnerPicker(householdMembers, owner, { owner = it })
        // Das Beispiel als Hilfetext wie im Merkposten-Dialog: Ein Platzhalter verschwand
        // mit dem Fokus, und der Dialog fokussiert das Feld sofort.
        OutlinedTextField(
            value = setNumber,
            onValueChange = { setNumber = NumericInput.setNumber(it) },
            label = { Text(stringResource(R.string.gallery_set_number)) },
            isError = numberError(setNumber, numberMissing) != null,
            supportingText = {
                numberError(setNumber, numberMissing)?.let { Text(stringResource(it), Modifier.announce()) }
                    ?: Text(stringResource(R.string.gallery_set_number_placeholder))
            },
            modifier = Modifier.fillMaxWidth().focusRequester(setFeldFokus), singleLine = true,
            shape = Formen.feld,
            keyboardOptions = NumericInput.setNumberKeyboard()
        )
        CountField(quantity, { quantity = it }, stringResource(R.string.gallery_quantity_hint))
        PurchasePriceField(purchasePrice, { purchasePrice = it }, stringResource(R.string.gallery_purchase_price)) {
            keyboard?.hide(); submit()
        }
        Zustandszeile(zustand = condition, onZustand = { condition = it })
        LagerortErfassung(lagerort, lagerorte, { lagerort = it })
    }
}
