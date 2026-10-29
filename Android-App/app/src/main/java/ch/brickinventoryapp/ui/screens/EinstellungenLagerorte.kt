package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Die eigenen Lagerorte verwalten, je Benutzer.
 *
 * Nur die eigenen: Ein Lagerort ist ein Regal in der eigenen Wohnung. Beim Set des
 * Enkels wählt der Grossvater aus dessen Liste, aber fremde Regale umzubenennen
 * wäre ein Versehen — lesen weit, schreiben eng.
 *
 * Löschen nur bei einem leeren Ort: Der Server sagt Nein, solange etwas darin
 * liegt (lagerort_in_benutzung). Stilles Leeren verlöre die Zuordnung von Sets,
 * die der Löschende nicht im Blick hatte, ohne Weg zurück.
 */
@Composable
internal fun LagerorteCard(vm: EinstellungenViewModel) {
    val lager by vm.lagerState.collectAsStateWithLifecycle()
    var neuerOrt by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(Unit) { vm.ladeEigeneLagerorte() }

    SettingsCard(
        title = stringResource(R.string.storage_manage),
        icon = Icons.Default.Inventory2,
    ) {
        Text(stringResource(R.string.storage_manage_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Abstaende.haar))
        // ── Der Stern: Vorgabe für Neuerfassungen ──
        //
        // Der Hinweis steht da, weil ein Stern allein nicht sagt, was er tut — und niemand
        // erraten soll, dass ein zweiter Druck ihn abschaltet.
        Text(stringResource(R.string.storage_default_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Abstaende.klein))

        if (lager.eigene.isEmpty()) {
            Text(stringResource(R.string.storage_empty),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (ort in lager.eigene) {
            // Schluessel ist der Name: Kommt er nach dem Umbenennen anders vom
            // Server zurueck (getrimmt), soll das Feld ihn zeigen.
            var name by rememberSaveable(ort.name) { mutableStateOf(ort.name) }
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { if (it.length <= 60) name = it },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                // ── Der Stern: gefüllt oder umrissen ──
                //
                // Der Unterschied liegt in der Form, nicht in der Farbe: Bei Rot-Grün-Schwäche
                // wäre ein farbig hervorgehobener Eintrag kein Unterschied. Die Beschreibung sagt
                // dasselbe in Worten — für die Sprachausgabe und für jeden, der den Stern nicht
                // deutet.
                val istVorgabe = lager.vorgabe?.id == ort.id
                IconButton(onClick = { vm.schalteLagerortVorgabe(ort.id, istVorgabe) }) {
                    Icon(
                        if (istVorgabe) Icons.Default.Star else Icons.Default.StarBorder,
                        stringResource(if (istVorgabe) R.string.storage_default_is
                                       else R.string.storage_default_set),
                    )
                }
                // Umbenennen auf Knopfdruck, NICHT beim Tippen: Anders als beim
                // Lagerort am Set schreibt ein Umbenennen hier alle Zuordnungen
                // mit um. Das nebenbei zu tun, waehrend jemand einen Buchstaben
                // aendert, waere zu viel Wirkung fuer zu wenig Geste.
                IconButton(
                    onClick = { vm.benenneLagerortUm(ort.id, name) },
                    enabled = name.isNotBlank() && name != ort.name,
                ) { Icon(Icons.Default.Save, stringResource(R.string.settings_save)) }
                IconButton(
                    onClick = { vm.loescheLagerort(ort.id) },
                ) { Icon(Icons.Default.Delete, stringResource(R.string.storage_delete)) }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            modifier = Modifier.fillMaxWidth().padding(top = Abstaende.klein)) {
            OutlinedTextField(
                value = neuerOrt,
                onValueChange = { if (it.length <= 60) neuerOrt = it },
                singleLine = true,
                placeholder = { Text(stringResource(R.string.storage_new), style = MaterialTheme.typography.bodySmall) },
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = { val n = neuerOrt.trim(); neuerOrt = ""; vm.legeLagerortAn(n) },
                enabled = neuerOrt.isNotBlank(),
                shape = Formen.knopf,
            ) { Text(stringResource(R.string.storage_add), style = MaterialTheme.typography.labelMedium) }
        }
    }
}
