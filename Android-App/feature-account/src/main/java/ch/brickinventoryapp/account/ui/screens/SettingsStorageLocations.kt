package ch.brickinventoryapp.account.ui.screens

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
import ch.brickinventoryapp.account.ui.viewmodel.SettingsActions
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.Section
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing

/**
 * Manage one's own storage locations, per user.
 * Only one's own: renaming someone else's shelves by mistake would be easy — read wide, write narrow.
 */
// The headline-first ListItem is deprecated since Material3 1.5; its successor lays rows out
// with other paddings and alignment (photos differ). Moving is a design step of its own.
@Suppress("DEPRECATION")
@Composable
internal fun LocationsCard(storage: StorageUiState, actions: SettingsActions) {
    // Which dialog is open survives a rotation: whoever is renaming something right now
    // shouldn't stand in front of the list again afterward.
    var newValue by rememberSaveable { mutableStateOf(false) }
    var rename by rememberSaveable { mutableStateOf<Int?>(null) }
    var delete by rememberSaveable { mutableStateOf<Int?>(null) }

    Text(stringResource(R.string.storage_manage_hint),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)

    Section(title = null, innerGap = false) {
        if (storage.own.isEmpty()) {
            ListItem(headlineContent = { Text(stringResource(R.string.storage_empty)) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent))
        }
        storage.own.forEachIndexed { i, location ->
            if (i > 0) HorizontalDivider()
            LocationRow(
                location = location,
                isDefault = storage.default?.id == location.id,
                onDefault = { actions.switchLocationDefault(location.id, it) },
                renameOn = { rename = location.id },
                deleteOn = { delete = location.id },
            )
        }
    }

    // Add in a subpage: full-width button as in account and household.
    // The floating button belongs to a tab's main object (sets, watchlist items).
    Button(onClick = { newValue = true }, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Default.Add, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Spacing.small))
        Text(stringResource(R.string.storage_add_button))
    }

    if (newValue) LocationNameDialog(
        title = stringResource(R.string.storage_new),
        start = "",
        confirm = stringResource(R.string.storage_add),
        onDone = { name -> newValue = false; actions.createLocation(name) },
        onCancel = { newValue = false },
    )
    storage.own.firstOrNull { it.id == rename }?.let { location ->
        // Renaming rewrites every assignment along with it — hence its own step with
        // "Save" instead of saving while typing.
        LocationNameDialog(
            title = stringResource(R.string.storage_rename_title),
            start = location.name,
            confirm = stringResource(R.string.settings_save),
            onDone = { name -> rename = null; if (name != location.name) actions.renameLocation(location.id, name) },
            onCancel = { rename = null },
        )
    }
    storage.own.firstOrNull { it.id == delete }?.let { location ->
        Prompt(
            title = stringResource(R.string.storage_delete_title),
            text = stringResource(R.string.storage_delete_text, location.name),
            confirm = stringResource(R.string.common_delete),
            onConfirm = { delete = null; actions.locationDeleteReserve(location) },
            onCancel = { delete = null },
            symbol = Icons.Default.Delete,
        )
    }
}

/**
 * A row: name, "Default" below it, star and menu on the right. The star is a
 * switch: TalkBack says "on/off" and names the location like the menu next to it; visibly
 * it differs in shape (filled/outlined), not only in color.
 */
@Suppress("DEPRECATION") // ListItem with headlineContent, see [LocationsCard]
@Composable
private fun LocationRow(
    location: LocationEntryView,
    isDefault: Boolean,
    onDefault: (Boolean) -> Unit,
    renameOn: () -> Unit,
    deleteOn: () -> Unit,
) {
    var menu by rememberSaveable { mutableStateOf(false) }
    ListItem(
        headlineContent = { Text(location.name, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        supportingContent = if (isDefault) ({ Text(stringResource(R.string.storage_default_label)) }) else null,
        leadingContent = { Icon(Icons.Default.Inventory2, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
        trailingContent = {
            Row {
                IconToggleButton(checked = isDefault, onCheckedChange = { onDefault(isDefault) }) {
                    Icon(if (isDefault) Icons.Default.Star else Icons.Default.StarBorder,
                        stringResource(R.string.storage_default_cd, location.name),
                        tint = if (isDefault) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Box {
                    WithTooltip(stringResource(R.string.storage_menu_cd, location.name)) {
                        IconButton(onClick = { menu = true }) {
                            Icon(Icons.Default.MoreVert, stringResource(R.string.storage_menu_cd, location.name))
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
    title: String,
    start: String,
    confirm: String,
    onDone: (String) -> Unit,
    onCancel: () -> Unit,
) {
    var name by rememberSaveable { mutableStateOf(start) }
    AddDialog(
        title = title,
        confirm = confirm,
        onConfirm = { onDone(name.trim()) },
        onCancel = onCancel,
        confirmEnabled = name.isNotBlank(),
        changed = name != start,
    ) {
        OutlinedTextField(
            shape = Shapes.field,
            value = name,
            onValueChange = { if (it.length <= 60) name = it },
            label = { Text(stringResource(R.string.storage_name)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
