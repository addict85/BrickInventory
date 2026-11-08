package ch.brickinventoryapp.sammlung.ui.screens

import androidx.compose.runtime.LaunchedEffect
import ch.brickinventoryapp.model.ui.model.MerkpostenAnsicht
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
import androidx.compose.foundation.layout.*
import ch.brickinventoryapp.ui.components.ansagen
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.components.ErfassenDialog
import ch.brickinventoryapp.ui.screens.LagerortErfassung
import ch.brickinventoryapp.ui.screens.OwnerPicker
import ch.brickinventoryapp.ui.screens.Zustandszeile

/**
 * Anzahl, Kaufpreis und Zustand vor der Übernahme — für ein gerade gekauftes Set
 * ist keine Vorgabe zuverlässig richtig. Dieselben Felder in derselben Reihenfolge
 * wie im Katalog-Dialog. Der Zustand ist mit dem des Merkpostens vorbelegt;
 * welcher Merkposten erledigt ist, entscheidet der Server.
 */
@Composable
internal fun UebernahmeDialog(
    merkposten: MerkpostenAnsicht,
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String> = emptyList(),
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    lagerortVorgabe: String = "",
    onDismiss: () -> Unit,
    onUebernehmen: (Int, String, String, String?) -> Unit,
) {
    var anzahl   by rememberSaveable { mutableStateOf("1") }
    var preis    by rememberSaveable { mutableStateOf("") }
    var zustand  by rememberSaveable { mutableStateOf(merkposten.condition) }
    // Schluessel ist die Vorgabe — dieselbe Begruendung wie im Katalog-Dialog.
    var lagerort by rememberSaveable(lagerortVorgabe) { mutableStateOf(lagerortVorgabe) }

    ErfassenDialog(
        titel = stringResource(R.string.wanted_take),
        bestaetigen = stringResource(R.string.wanted_take),
        onBestaetigen = { onUebernehmen(anzahl.toIntOrNull() ?: 1, preis, zustand,
                                        lagerort.trim().takeIf { it.isNotEmpty() }) },
        onAbbrechen = onDismiss,
    ) {
        Text(merkposten.name ?: merkposten.setNumber, style = MaterialTheme.typography.bodyMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            // NumericInput statt eigener Filterung: Die Regel, was eine Zahl ist (genau ein
            // Trennzeichen), steht einmal in util/NumericInput.kt.
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
                keyboardOptions = NumericInput.preisTastatur(),
                modifier = Modifier.weight(1f),
            )
        }
        // Mit Beschriftung „Zustand“: Zwei Chips ohne Überschrift sagten nicht, wonach sie fragen.
        Zustandszeile(zustand, { zustand = it })
        // Lagerort wie bei jeder anderen Erfassung.
        LagerortErfassung(lagerort, lagerorte, { lagerort = it })
    }
}

/**
 * Die Erfassungsmaske als Dialog, wie AddSetDialog in der Galerie — eine Karte
 * kostete auf jedem Bildschirm Platz. Nummer, Zustand, Konto; Anzahl und Kaufpreis
 * erst bei der Übernahme, ein Merkposten hat beides nicht. Der Cursor steht sofort
 * im Nummernfeld; die kurze Pause davor braucht es, weil das Feld beim ersten
 * Durchlauf noch nicht angeordnet ist.
 */
@Composable
internal fun MerkpostenErfassenDialog(
    householdMembers: List<MitgliedAnsicht>,
    defaultCondition: String,
    onDismiss: () -> Unit,
    onAnlegen: (String, String, Int?) -> Unit,
) {
    var nummer  by rememberSaveable { mutableStateOf("") }
    var zustand by rememberSaveable { mutableStateOf(defaultCondition) }
    // Vorbelegt mit dem eigenen Konto — wer nichts waehlt, wuenscht fuer sich.
    var besitzer by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }

    // „Auf die Merkliste“ bleibt antippbar und markiert dann das leere Feld: Grau ohne
    // Grund liess raten, warum nichts geschah.
    var nummerFehlt by rememberSaveable { mutableStateOf(false) }
    val nummerFokus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(120)
        try { nummerFokus.requestFocus() } catch (_: Exception) { /* Dialog schon zu */ }
    }

    ErfassenDialog(
        titel = stringResource(R.string.wanted_add_title),
        bestaetigen = stringResource(R.string.wanted_add_submit),
        // Nur mitschicken, wenn es ueberhaupt eine Wahl gab — sonst schreibt der
        // Server auf das eigene Konto.
        onBestaetigen = {
            if (nummer.isBlank()) nummerFehlt = true
            else onAnlegen(nummer, zustand, if (householdMembers.size > 1) besitzer else null)
        },
        onAbbrechen = onDismiss,
    ) {
        OutlinedTextField(
            value = nummer,
            onValueChange = { nummer = NumericInput.setNumber(it) },
            label = { Text(stringResource(R.string.gallery_set_number)) },
            // Als Hilfetext statt Platzhalter: Der Platzhalter verschwand mit dem
            // Fokus, und der Dialog fokussiert das Feld sofort.
            isError = nummerFehlt && nummer.isBlank(),
            supportingText = {
                if (nummerFehlt && nummer.isBlank()) Text(stringResource(R.string.erfassen_nummer_fehlt), Modifier.ansagen())
                else Text(stringResource(R.string.gallery_set_number_placeholder))
            },
            singleLine = true,
            shape = Formen.feld,
            // Dieselbe Tastatur wie im AddSetDialog. Ein Zahlenfeld
            // ohne Tastaturwahl oeffnet die Buchstabentastatur — die
            // Regel dazu steht in NumericInputTest.
            keyboardOptions = NumericInput.setnummerTastatur(),
            modifier = Modifier.fillMaxWidth().focusRequester(nummerFokus),
        )
        // Mit Beschriftung „Zustand“: Zwei Chips ohne Überschrift sagten nicht, wonach sie fragen.
        Zustandszeile(zustand, { zustand = it })
        // Derselbe Waehler wie beim Erfassen eines Sets. Bei einem
        // Einzelkonto blendet er sich selbst aus (members.size < 2).
        OwnerPicker(householdMembers, besitzer, { besitzer = it })
    }
}
