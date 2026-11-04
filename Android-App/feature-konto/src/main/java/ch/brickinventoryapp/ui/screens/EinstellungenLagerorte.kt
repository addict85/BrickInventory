package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.Abschnitt
import ch.brickinventoryapp.ui.components.ErfassenDialog
import ch.brickinventoryapp.ui.components.Rueckfrage
import ch.brickinventoryapp.ui.model.LagerortEintragAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel

/**
 * Die eigenen Lagerorte verwalten, je Benutzer.
 *
 * Nur die eigenen: Ein Lagerort ist ein Regal in der eigenen Wohnung. Beim Set des
 * Enkels wählt der Grossvater aus dessen Liste, aber fremde Regale umzubenennen
 * wäre ein Versehen — lesen weit, schreiben eng.
 *
 * Löschen nur bei einem leeren Ort und nach Rückfrage: Der Server sagt Nein, solange
 * etwas darin liegt (lagerort_in_benutzung).
 */
@Composable
internal fun LagerorteCard(vm: EinstellungenViewModel) {
    val lager by vm.lagerState.collectAsStateWithLifecycle()
    // Welcher Dialog offen ist, überlebt eine Drehung: Wer gerade umbenennt, soll
    // danach nicht vor der Liste stehen.
    var neu by rememberSaveable { mutableStateOf(false) }
    var umbenennen by rememberSaveable { mutableStateOf<Int?>(null) }
    var loeschen by rememberSaveable { mutableStateOf<Int?>(null) }

    LaunchedEffect(Unit) { vm.ladeEigeneLagerorte() }

    Text(stringResource(R.string.storage_manage_hint),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)

    Abschnitt(titel = null, innenAbstand = false) {
        if (lager.eigene.isEmpty()) {
            ListItem(headlineContent = { Text(stringResource(R.string.storage_empty)) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent))
        }
        lager.eigene.forEachIndexed { i, ort ->
            if (i > 0) HorizontalDivider()
            LagerortZeile(
                ort = ort,
                istVorgabe = lager.vorgabe?.id == ort.id,
                onVorgabe = { vm.schalteLagerortVorgabe(ort.id, it) },
                onUmbenennen = { umbenennen = ort.id },
                onLoeschen = { loeschen = ort.id },
            )
        }
    }

    // Hinzufügen in einer Unterseite: Knopf in voller Breite wie in Konto und Haushalt.
    // Der schwebende Knopf gehört dem Hauptobjekt eines Reiters (Sets, Merkposten).
    Button(onClick = { neu = true }, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Default.Add, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
        Spacer(Modifier.width(8.dp))
        Text(stringResource(R.string.storage_add_button))
    }

    if (neu) LagerortNameDialog(
        titel = stringResource(R.string.storage_new),
        start = "",
        bestaetigen = stringResource(R.string.storage_add),
        onFertig = { name -> neu = false; vm.legeLagerortAn(name) },
        onAbbrechen = { neu = false },
    )
    lager.eigene.firstOrNull { it.id == umbenennen }?.let { ort ->
        // Umbenennen schreibt alle Zuordnungen mit um — darum ein eigener Schritt mit
        // „Speichern“ statt Speichern beim Tippen.
        LagerortNameDialog(
            titel = stringResource(R.string.storage_rename_title),
            start = ort.name,
            bestaetigen = stringResource(R.string.settings_save),
            onFertig = { name -> umbenennen = null; if (name != ort.name) vm.benenneLagerortUm(ort.id, name) },
            onAbbrechen = { umbenennen = null },
        )
    }
    lager.eigene.firstOrNull { it.id == loeschen }?.let { ort ->
        Rueckfrage(
            titel = stringResource(R.string.storage_delete_title),
            text = stringResource(R.string.storage_delete_text, ort.name),
            bestaetigen = stringResource(R.string.common_delete),
            onBestaetigen = { loeschen = null; vm.loescheLagerort(ort.id) },
            onAbbrechen = { loeschen = null },
            symbol = Icons.Default.Delete,
        )
    }
}

/**
 * Eine Zeile: Name, darunter „Vorgabe“, rechts Stern und Menü. Der Stern ist ein
 * Schalter: TalkBack sagt „an/aus“ und nennt den Ort wie das Menü daneben; sichtbar
 * unterscheidet er sich in der Form (gefüllt/umrissen), nicht nur in der Farbe.
 */
@Composable
private fun LagerortZeile(
    ort: LagerortEintragAnsicht,
    istVorgabe: Boolean,
    onVorgabe: (Boolean) -> Unit,
    onUmbenennen: () -> Unit,
    onLoeschen: () -> Unit,
) {
    var menue by rememberSaveable { mutableStateOf(false) }
    ListItem(
        headlineContent = { Text(ort.name, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        supportingContent = if (istVorgabe) ({ Text(stringResource(R.string.storage_default_label)) }) else null,
        leadingContent = { Icon(Icons.Default.Inventory2, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
        trailingContent = {
            Row {
                IconToggleButton(checked = istVorgabe, onCheckedChange = { onVorgabe(istVorgabe) }) {
                    Icon(if (istVorgabe) Icons.Default.Star else Icons.Default.StarBorder,
                        stringResource(R.string.storage_vorgabe_cd, ort.name),
                        tint = if (istVorgabe) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Box {
                    IconButton(onClick = { menue = true }) {
                        Icon(Icons.Default.MoreVert, stringResource(R.string.storage_menu_cd, ort.name))
                    }
                    DropdownMenu(menue, { menue = false }) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.storage_rename)) },
                            leadingIcon = { Icon(Icons.Default.Edit, null) },
                            onClick = { menue = false; onUmbenennen() },
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.common_delete)) },
                            leadingIcon = { Icon(Icons.Default.Delete, null) },
                            onClick = { menue = false; onLoeschen() },
                        )
                    }
                }
            }
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

/** Name eines Lagerorts eingeben — für Neu und Umbenennen dieselbe Maske. */
@Composable
private fun LagerortNameDialog(
    titel: String,
    start: String,
    bestaetigen: String,
    onFertig: (String) -> Unit,
    onAbbrechen: () -> Unit,
) {
    var name by rememberSaveable { mutableStateOf(start) }
    ErfassenDialog(
        titel = titel,
        bestaetigen = bestaetigen,
        onBestaetigen = { onFertig(name.trim()) },
        onAbbrechen = onAbbrechen,
        bestaetigenAn = name.isNotBlank(),
    ) {
        OutlinedTextField(
            shape = Formen.feld,
            value = name,
            onValueChange = { if (it.length <= 60) name = it },
            label = { Text(stringResource(R.string.storage_name)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
