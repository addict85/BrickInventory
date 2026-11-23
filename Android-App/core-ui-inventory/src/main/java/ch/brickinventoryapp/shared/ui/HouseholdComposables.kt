package ch.brickinventoryapp.shared.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.AccountView
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.accountOptions
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing

/**
 * The account filter, as an inventory view shows it: top left, with the
 * usual spacing, only when there is something to choose. One function for parts,
 * minifigs and gallery, so a deviating spacing doesn't only stand out on a
 * tab change.
 */
@Composable
fun ScopeFilterRow(
    members: List<MemberView>,
    current: String,
    onSelect: (String) -> Unit,
    // ── The storage-location filter sits next to it, not below it ──
    //
    // Two freely combinable questions about the same list („whose“ and „where“) —
    // side by side you see both answers at a glance, as in the web app
    // (public/index.html, scope-* and storage-* on one row). Defaults, so
    // screens that only need the account filter can call it unchanged.
    storageLocations: List<LocationView> = emptyList(),
    storageCurrent: String = "",
    onStorageSelect: (String) -> Unit = {},
) {
    // Both can individually be absent: the account filter without sub-accounts, the
    // storage-location filter as long as no location is captured anywhere. If both are empty,
    // no row is produced — otherwise an empty strip would sit there.
    val showAccounts = members.size > 1
    val showStorage  = storageLocations.isNotEmpty()
    if (!showAccounts && !showStorage) return
    Row(
        Modifier.padding(start = 14.dp, top = Spacing.small),
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showAccounts) {
            ScopeFilterChip(members = members, current = current, onSelect = onSelect)
        }
        if (showStorage) {
            LocationFilterChip(locations = storageLocations, current = storageCurrent, onSelect = onStorageSelect)
        }
    }
}

/**
 * Storage-location filter — the same shape as the account filter next to it. A function
 * of its own instead of ScopeFilterChip with different data: the entries are locations instead of accounts, and
 * the first one is called „Alle Lagerorte“ — a shared function would need more
 * conditions than it would save.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LocationFilterChip(
    locations: List<LocationView>,
    current: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (locations.isEmpty()) return
    val all = stringResource(R.string.filter_storage_all)
    // If the stored choice points to a location that's now empty, an empty
    // label would otherwise sit here above a filtered list — the same
    // trap as with the account filter.
    val value = if (locations.any { it.location == current }) current else ""
    var open by rememberSaveable { mutableStateOf(false) }

    Box(modifier) {
        AssistChip(
            onClick = { open = true },
            label = {
                Text(if (value.isBlank()) all else value,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium)
            },
            trailingIcon = {
                Icon(Icons.Default.ArrowDropDown, all, Modifier.size(withFont(18.dp)))
            },
            shape = Shapes.tile,
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(all, fontWeight = if (value.isBlank()) FontWeight.Bold else FontWeight.Normal) },
                onClick = { open = false; if (value.isNotBlank()) onSelect("") }
            )
            locations.forEach { o ->
                DropdownMenuItem(
                    text = {
                        Text("${o.location}  (${o.sets + o.parts})",
                            fontWeight = if (o.location == value) FontWeight.Bold else FontWeight.Normal)
                    },
                    onClick = { open = false; if (o.location != value) onSelect(o.location) }
                )
            }
        }
    }
}

/**
 * Account filter of a view — All accounts, own, then each sub-account
 * by name. Only for a main account with sub-accounts: a choice with exactly
 * one answer is no choice. Filtering happens on the server (`accounts=`), because
 * the tile wall could be sieved here, but not the total count and the
 * valuation.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScopeFilterChip(
    members: List<MemberView>,
    current: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val options = accountOptions(
        members,
        labelAll  = stringResource(R.string.household_scope_all),
        labelOwn  = stringResource(R.string.household_scope_own),
    )
    if (options.isEmpty()) return

    // If the stored choice points to an account that's now unlinked,
    // an empty label would otherwise sit here above a filtered list.
    val value = ScopeFilter.sanitize(current, options)
    val label = options.firstOrNull { it.first == value }?.second ?: options.first().second
    var open by rememberSaveable { mutableStateOf(false) }

    Box(modifier) {
        AssistChip(
            onClick = { open = true },
            label = {
                Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium)
            },
            trailingIcon = {
                Icon(Icons.Default.ArrowDropDown,
                    stringResource(R.string.household_scope_label), Modifier.size(18.dp))
            },
            shape = Shapes.tile,
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (v, text) ->
                DropdownMenuItem(
                    text = { Text(text, fontWeight = if (v == value) FontWeight.Bold else FontWeight.Normal) },
                    onClick = { open = false; if (v != value) onSelect(v) }
                )
            }
        }
    }
}

/**
 * Owner badges — only in a household. The server only attaches `owners` when
 * several accounts are in the Blickfeld; in a single account „belongs to me“ on every
 * tile would be noise, in a household it's the most important piece of information — without it
 * you'd move the wrong copy. Several names: the same set across several accounts,
 * deliberately one tile with the sum of the quantities.
 */
// ExperimentalLayoutApi applies to FlowRow — the annotation belongs on the
// FUNCTION. An @OptIn in the middle of the body is not a valid statement; together
// with the parenthesization `(FlowRow(...)) { … }` Kotlin read that as „call the
// result" and reported "Unresolved reference 'invoke'".
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OwnerBadges(owners: List<AccountView>, modifier: Modifier = Modifier) {
    if (owners.isEmpty()) return
    // FlowRow instead of Row: two owners with long names are wider than the tile,
    // in a Row the labels would overlap. FlowRow wraps, so
    // all of them stay readable.
    FlowRow(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.hairline),
    ) {
        owners.forEach { o ->
            Surface(
                shape = Shapes.tag,
                color = MaterialTheme.colorScheme.secondaryContainer,
            ) {
                Text(
                    o.username,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                    style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = Spacing.hairline)
                )
            }
        }
    }
}

/**
 * Account choice during capture — „Für Konto“. Invisible without a household; the server
 * then stays with the own account. The account ID goes along as `owner_user_id`; whether
 * it's allowed is checked by the server (canWriteFor), not the app.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OwnerPicker(
    members: List<MemberView>,
    selected: Int?,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (members.size < 2) return
    var open by rememberSaveable { mutableStateOf(false) }
    val current = members.firstOrNull { it.id == selected } ?: members.first()

    Box(modifier) {
        OutlinedButton(onClick = { open = true }, colors = secondaryButtonColors(), border = secondaryButtonRand()) {
            Text(stringResource(R.string.household_for_account) + ": " + current.username,
                style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(Icons.Default.ArrowDropDown, null, Modifier.size(withFont(18.dp)))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            members.forEach { m ->
                DropdownMenuItem(
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(m.username,
                                fontWeight = if (m.id == current.id) FontWeight.Bold else FontWeight.Normal)
                            if (m.isSelf) Text(stringResource(R.string.household_self),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    },
                    onClick = { open = false; onSelect(m.id) }
                )
            }
        }
    }
}
