package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import ch.brickinventoryapp.R
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.data.model.Part
import ch.brickinventoryapp.data.model.PartsStats
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.data.model.Acquisition
import ch.brickinventoryapp.data.model.BrickColor
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil.compose.AsyncImage
import coil.ImageLoader
import coil.request.ImageRequest
import ch.brickinventoryapp.util.NumericInput

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddPartDialog(
    colors: List<BrickColor> = emptyList(),
    onDismiss: () -> Unit,
    onAdd: (String, Int, String?, String?, Int, String?, Double?, String?, Int?) -> Unit,
    defaultCondition: String = "N",
    /** Konten des Haushalts — ohne Unterkonten bleibt die Auswahl verborgen. */
    householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember> = emptyList()
) {
    var partNumber by rememberSaveable { mutableStateOf("") }
    var quantity   by rememberSaveable { mutableStateOf("1") }
    var unitPrice  by rememberSaveable { mutableStateOf("") }
    var note       by rememberSaveable { mutableStateOf("") }
    var selectedColor by remember { mutableStateOf<BrickColor?>(null) }
    var colorMenuExpanded by rememberSaveable { mutableStateOf(false) }
    var condition  by rememberSaveable { mutableStateOf(defaultCondition) }
    // Vorbelegt mit dem eigenen Konto: Wer nichts wählt, erfasst für sich —
    // dasselbe Verhalten wie vor der Haushaltssicht.
    var owner by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }


    fun submit() {
        if (partNumber.isNotBlank()) {
            onAdd(
                partNumber, selectedColor?.id ?: 0, selectedColor?.name, selectedColor?.hex,
                quantity.toIntOrNull() ?: 1,
                note.ifBlank { null },
                unitPrice.replace(',', '.').toDoubleOrNull(),
                condition,
                // Ohne Haushalt gar nichts mitschicken — der Server bleibt
                // dann beim eigenen Konto.
                if (householdMembers.size > 1) owner else null
            )
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Add, null, tint = MaterialTheme.colorScheme.primary) },
        title = { Text(stringResource(R.string.parts_add_title), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OwnerPicker(householdMembers, owner, { owner = it })
                OutlinedTextField(
                    value = partNumber, onValueChange = { partNumber = it },
                    label = { Text(stringResource(R.string.parts_part_number)) }, placeholder = { Text(stringResource(R.string.parts_part_number_placeholder)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf
                )
                ExposedDropdownMenuBox(
                    expanded = colorMenuExpanded,
                    onExpandedChange = { colorMenuExpanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedColor?.name ?: stringResource(R.string.parts_no_color),
                        onValueChange = {},
                        readOnly = true,
                        label = { Text(stringResource(R.string.parts_color_label)) },
                        leadingIcon = {
                            val swatch = selectedColor?.hex?.let {
                                try { Color(android.graphics.Color.parseColor("#$it")) } catch (_: Exception) { null }
                            }
                            if (swatch != null) {
                                Box(Modifier.padding(start = 12.dp).size(14.dp)
                                    .clip(androidx.compose.foundation.shape.CircleShape).background(swatch))
                            }
                        },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = colorMenuExpanded) },
                        modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable, enabled = true),
                        singleLine = true,
                        shape = Formen.knopf
                    )
                    ExposedDropdownMenu(expanded = colorMenuExpanded, onDismissRequest = { colorMenuExpanded = false }) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.parts_no_color)) },
                            onClick = { selectedColor = null; colorMenuExpanded = false }
                        )
                        colors.forEach { c ->
                            DropdownMenuItem(
                                text = { Text(c.name) },
                                leadingIcon = {
                                    val swatch = c.hex?.let {
                                        try { Color(android.graphics.Color.parseColor("#$it")) } catch (_: Exception) { null }
                                    }
                                    if (swatch != null) {
                                        Box(Modifier.size(14.dp).clip(androidx.compose.foundation.shape.CircleShape).background(swatch))
                                    }
                                },
                                onClick = { selectedColor = c; colorMenuExpanded = false }
                            )
                        }
                    }
                }
                OutlinedTextField(
                    value = quantity, onValueChange = { quantity = NumericInput.quantity(it) },
                    label = { Text(stringResource(R.string.parts_quantity)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf,
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                OutlinedTextField(
                    value = unitPrice, onValueChange = { unitPrice = NumericInput.price(it) },
                    label = { Text(stringResource(R.string.parts_unit_price)) }, placeholder = { Text(stringResource(R.string.parts_unit_price_placeholder)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf,
                    keyboardOptions = NumericInput.preisTastatur()
                )
                OutlinedTextField(
                    value = note, onValueChange = { note = it },
                    label = { Text(stringResource(R.string.parts_note)) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    shape = Formen.knopf
                )
                Zustandszeile(zustand = condition, onZustand = { condition = it })
            }
        },
        confirmButton = { TextButton(onClick = { submit(); onDismiss() }) { Text(stringResource(R.string.parts_add_button)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.parts_cancel)) } }
    )
}
