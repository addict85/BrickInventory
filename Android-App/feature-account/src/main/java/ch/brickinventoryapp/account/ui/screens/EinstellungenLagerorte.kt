package ch.brickinventoryapp.account.ui.screens

import ch.brickinventoryapp.state.ui.LagerUiState
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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.Abschnitt
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.account.ui.viewmodel.EinstellungenAktionen
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Manage one's own storage locations, per user.
 * Only one's own: renaming someone else's shelves by mistake would be easy — read wide, write narrow.
 */
@Composable
internal fun LocationsCard(lager: LagerUiState, aktionen: EinstellungenAktionen) {
    // Which dialog is open survives a rotation: whoever is renaming something right now
    // shouldn't stand in front of the list again afterward.
    var neu by rememberSaveable { mutableStateOf(false) }
    var umbenennen by rememberSaveable { mutableStateOf<Int?>(null) }
    var loeschen by rememberSaveable { mutableStateOf<Int?>(null) }

    Text(stringResource(R.string.storage_manage_hint),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)

    Abschnitt(titel = null, innerGap = false) {
        if (lager.eigene.isEmpty()) {
            ListItem(headlineContent = { Text(stringResource(R.string.storage_empty)) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent))
        }
        lager.eigene.forEachIndexed { i, ort ->
            if (i > 0) HorizontalDivider()
            LocationRow(
                ort = ort,
                isDefault = lager.vorgabe?.id == ort.id,
                onDefault = { aktionen.switchLocationDefault(ort.id, it) },
                renameOn = { umbenennen = ort.id },
                deleteOn = { loeschen = ort.id },
            )
        }
    }

    // Add in a subpage: full-width button as in account and household.
    // The floating button belongs to a tab's main object (sets, watchlist items).
    Button(onClick = { neu = true }, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Default.Add, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Abstaende.klein))
        Text(stringResource(R.string.storage_add_button))
    }

    if (neu) LocationNameDialog(
        titel = stringResource(R.string.storage_new),
        start = "",
        bestaetigen = stringResource(R.string.storage_add),
        onFertig = { name -> neu = false; aktionen.putLocationAn(name) },
        onAbbrechen = { neu = false },
    )
    lager.eigene.firstOrNull { it.id == umbenennen }?.let { ort ->
        // Renaming rewrites every assignment along with it — hence its own step with
        // "Save" instead of saving while typing.
        LocationNameDialog(
            titel = stringResource(R.string.storage_rename_title),
            start = ort.name,
            bestaetigen = stringResource(R.string.settings_save),
            onFertig = { name -> umbenennen = null; if (name != ort.name) aktionen.nameLocationUm(ort.id, name) },
            onAbbrechen = { umbenennen = null },
        )
    }
    lager.eigene.firstOrNull { it.id == loeschen }?.let { ort ->
        Prompt(
            titel = stringResource(R.string.storage_delete_title),
            text = stringResource(R.string.storage_delete_text, ort.name),
            bestaetigen = stringResource(R.string.common_delete),
            onBestaetigen = { loeschen = null; aktionen.locationDeleteReserve(ort) },
            onAbbrechen = { loeschen = null },
            symbol = Icons.Default.Delete,
        )
    }
}

/**
 * A row: name, "Default" below it, star and menu on the right. The star is a
 * switch: TalkBack says "on/off" and names the location like the menu next to it; visibly
 * it differs in shape (filled/outlined), not only in color.
 */
@Composable
private fun LocationRow(
    ort: LocationEntryView,
    isDefault: Boolean,
    onDefault: (Boolean) -> Unit,
    renameOn: () -> Unit,
    deleteOn: () -> Unit,
) {
    var menu by rememberSaveable { mutableStateOf(false) }
    ListItem(
        headlineContent = { Text(ort.name, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        supportingContent = if (isDefault) ({ Text(stringResource(R.string.storage_default_label)) }) else null,
        leadingContent = { Icon(Icons.Default.Inventory2, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
        trailingContent = {
            Row {
                IconToggleButton(checked = isDefault, onCheckedChange = { onDefault(isDefault) }) {
                    Icon(if (isDefault) Icons.Default.Star else Icons.Default.StarBorder,
                        stringResource(R.string.storage_vorgabe_cd, ort.name),
                        tint = if (isDefault) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Box {
                    MitTooltip(stringResource(R.string.storage_menu_cd, ort.name)) {
                        IconButton(onClick = { menu = true }) {
                            Icon(Icons.Default.MoreVert, stringResource(R.string.storage_menu_cd, ort.name))
                        }
                    }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.storage_rename)) },
                            leadingIcon = { Icon(Icons.Default.Edit, null) },
                            onClick = { menu = false; renameOn() },
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.common_delete)) },
                            leadingIcon = { Icon(Icons.Default.Delete, null) },
                            onClick = { menu = false; deleteOn() },
                        )
                    }
                }
            }
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

/** Enter a storage location's name — the same form for new and renaming. */
@Composable
private fun LocationNameDialog(
    titel: String,
    start: String,
    bestaetigen: String,
    onFertig: (String) -> Unit,
    onAbbrechen: () -> Unit,
) {
    var name by rememberSaveable { mutableStateOf(start) }
    AddDialog(
        titel = titel,
        bestaetigen = bestaetigen,
        onBestaetigen = { onFertig(name.trim()) },
        onAbbrechen = onAbbrechen,
        confirmAn = name.isNotBlank(),
        geaendert = name != start,
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
