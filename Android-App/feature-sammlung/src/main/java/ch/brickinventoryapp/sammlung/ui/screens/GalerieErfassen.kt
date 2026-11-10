package ch.brickinventoryapp.sammlung.ui.screens

import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.sammlung.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.ui.components.ErfassenDialog
import ch.brickinventoryapp.gemeinsam.ui.LagerortErfassung
import ch.brickinventoryapp.gemeinsam.ui.OwnerPicker
import ch.brickinventoryapp.gemeinsam.ui.Zustandszeile
import ch.brickinventoryapp.gemeinsam.ui.erfassungUngueltig

/**
 * Ein Set erfassen. Zur Wahl steht der VORRAT an Lagerorten, nicht die belegten:
 * Die Filterliste enthält nur, worin schon etwas liegt; beim Erfassen soll auch
 * ein leeres Regal zur Wahl stehen.
 */
@Composable
internal fun GalerieErfassen(zustand: GalerieZustand, ereignisse: GalerieEreignisse, onSchliessen: () -> Unit) {
    AddSetDialog(
        onDismiss = onSchliessen,
        onAdd = { wunsch -> onSchliessen(); ereignisse.setErfassen(wunsch) },
        householdMembers = zustand.blick.householdMembers,
        defaultCondition = zustand.app.userDefaultCondition ?: Zustand.NEU,
        lagerorte = zustand.lager.eigene.map { it.name },
        vorgabe = zustand.lager.vorgabe?.name ?: "",
    )
}

/** Ohne Haushalt gar nichts mitschicken — der Server bleibt dann beim eigenen Konto. */
private fun eigentuemerFuerErfassung(mitglieder: List<MitgliedAnsicht>, gewaehlt: Int?): Int? =
    if (mitglieder.size > 1) gewaehlt else null

/** Ist der Dialog schon zu, wirft requestFocus; dann gibt es nichts mehr zu fokussieren. */
private fun FocusRequester.fokusWennOffen() {
    try { requestFocus() } catch (_: Exception) { /* Dialog schon zu */ }
}

@Composable
private fun FokusNachPause(ziel: FocusRequester) = LaunchedEffect(Unit) {
    kotlinx.coroutines.delay(120)
    ziel.fokusWennOffen()
}

/**
 * Der Hinweis am Setnummer-Feld (null: nichts zu beanstanden). Vor dem ersten Versuch zu
 * erfassen bleibt das Feld ruhig, damit "75192-" beim Tippen nicht schon als Fehler gilt.
 */
private fun nummerFehler(nummer: String, geprueft: Boolean): Int? = when {
    !geprueft -> null
    nummer.isBlank() -> R.string.erfassen_nummer_fehlt
    !NumericInput.istSetnummer(nummer) -> R.string.erfassen_nummer_ungueltig
    else -> null
}

@Composable
fun AddSetDialog(
    onDismiss: () -> Unit,
    onAdd: (Erfassungswunsch) -> Unit,
    defaultCondition: Zustand = Zustand.NEU,
    /** Konten des Haushalts — ohne Unterkonten bleibt die Auswahl verborgen. */
    householdMembers: List<MitgliedAnsicht> = emptyList(),
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String> = emptyList(),
    /**
     * Der Ort, der schon dastehen soll (der Stern aus den Einstellungen); leer heisst
     * keine Vorgabe.
     */
    vorgabe: String = "",
    /** Nur Tests: Ein blinkender Cursor lässt Robolectric nie zur Ruhe kommen. */
    sofortFokus: Boolean = true,
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
    if (sofortFokus) FokusNachPause(setFeldFokus)
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
    var nummerFehlt by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        if (nummerFehler(setNumber, geprueft = true) != null) {
            nummerFehlt = true
            if (sofortFokus) setFeldFokus.fokusWennOffen()
        } else if (!erfassungUngueltig(quantity, purchasePrice)) {
            // Bei unlesbarer Menge oder unlesbarem Preis bleibt der Dialog offen; die Felder zeigen den Fehler.
            onAdd(Erfassungswunsch(
                setNumber = setNumber,
                menge = quantity.toIntOrNull() ?: 1,
                kaufpreis = NumericInput.leseBetrag(purchasePrice),
                zustand = condition,
                besitzer = eigentuemerFuerErfassung(householdMembers, owner),
                lagerort = lagerort.trim().takeIf { it.isNotEmpty() },
            ))
        }
    }

    // Derselbe Rahmen wie jede Erfassung (ErfassenDialog): Titel links, ohne Symbol.
    ErfassenDialog(
        titel = stringResource(R.string.gallery_add_set_title),
        bestaetigen = stringResource(R.string.gallery_add),
        onBestaetigen = { submit() },
        onAbbrechen = onDismiss,
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
            isError = nummerFehler(setNumber, nummerFehlt) != null,
            supportingText = {
                nummerFehler(setNumber, nummerFehlt)?.let { Text(stringResource(it), Modifier.ansagen()) }
                    ?: Text(stringResource(R.string.gallery_set_number_placeholder))
            },
            modifier = Modifier.fillMaxWidth().focusRequester(setFeldFokus), singleLine = true,
            shape = Formen.feld,
            keyboardOptions = NumericInput.setnummerTastatur()
        )
        OutlinedTextField(
            value = quantity,
            onValueChange = { quantity = NumericInput.quantity(it) },
            label = { Text(stringResource(R.string.common_quantity)) },
            isError = NumericInput.mengeUngueltig(quantity),
            supportingText = { if (NumericInput.mengeUngueltig(quantity)) Text(stringResource(R.string.erfassen_menge_ungueltig), Modifier.ansagen()) },
            modifier = Modifier.fillMaxWidth(), singleLine = true,
            shape = Formen.feld,
            keyboardOptions = NumericInput.ganzzahlTastatur()
        )
        OutlinedTextField(
            value = purchasePrice,
            onValueChange = { purchasePrice = NumericInput.price(it) },
            label = { Text(stringResource(R.string.gallery_purchase_price)) },
            placeholder = { Text(stringResource(R.string.common_unit_price_placeholder)) },
            isError = NumericInput.preisUngueltig(purchasePrice),
            supportingText = { if (NumericInput.preisUngueltig(purchasePrice)) Text(stringResource(R.string.erfassen_preis_ungueltig), Modifier.ansagen()) },
            modifier = Modifier.fillMaxWidth(), singleLine = true,
            shape = Formen.feld,
            keyboardOptions = NumericInput.preisTastatur(),
            keyboardActions = KeyboardActions(onDone = { keyboard?.hide(); submit() })
        )
        Zustandszeile(zustand = condition, onZustand = { condition = it })
        LagerortErfassung(lagerort, lagerorte, { lagerort = it })
    }
}
