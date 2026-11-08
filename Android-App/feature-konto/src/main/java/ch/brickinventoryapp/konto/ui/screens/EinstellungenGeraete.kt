package ch.brickinventoryapp.konto.ui.screens

import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.konto.ui.*
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.konto.ui.GeraeteUiState
import ch.brickinventoryapp.model.ui.model.GeraetAnsicht
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.ui.screens.SettingsCard

/**
 * Angemeldete Geräte: die ausgestellten Zugänge sehen und aussperren.
 * Ausführlich: docs/begruendungen/feature-konto/konto/ui/screens/EinstellungenKonto.kt.md#geraetecard
 */
@Composable
internal fun GeraeteCard(
    zustand: GeraeteUiState,
    onReload: () -> Unit,
    onRevoke: (String) -> Unit,
    onRevokeOthers: () -> Unit,
) {
    var fragt by rememberSaveable { mutableStateOf<String?>(null) }
    var fragtAlle by rememberSaveable { mutableStateOf(false) }

    SettingsCard(title = stringResource(R.string.tokens_title), icon = Icons.Default.Devices) {
        Text(stringResource(R.string.tokens_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Abstaende.mittel))

        when {
            zustand.laedt && zustand.geraete.isEmpty() ->
                CircularProgressIndicator(Modifier.size(22.dp))
            zustand.fehler != null ->
                Text(zustand.fehler, color = MaterialTheme.colorScheme.error,
                     style = MaterialTheme.typography.bodySmall)
            zustand.geraete.isEmpty() ->
                Text(stringResource(R.string.tokens_none),
                     style = MaterialTheme.typography.bodySmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                for (g in zustand.geraete) {
                    GeraetZeile(g, onEntwerten = { fragt = g.tokenId })
                }
            }
        }

        Row(Modifier.padding(top = Abstaende.mittel), horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            OutlinedButton(onClick = onReload, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                Text(stringResource(R.string.tokens_reload))
            }
            // Nur anbieten, wenn es wirklich andere gibt — ein Knopf, der
            // immer „es gibt keine anderen" meldet, ist schlimmer als keiner.
            if (zustand.geraete.count { !it.aktuell } > 0) {
                OutlinedButton(
                    onClick = { fragtAlle = true },
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    border = nebenKnopfRand(),
                ) { Text(stringResource(R.string.tokens_revoke_others)) }
            }
        }
    }

    // Rückfrage: Ein Zugang, der weg ist, kommt nicht wieder — das Gerät
    // dahinter muss sich neu anmelden.
    val zuEntwerten = fragt
    if (zuEntwerten != null) EntwertenFrage(zustand, zuEntwerten,
        onSchliessen = { fragt = null },
        onEntwerten = { fragt = null; onRevoke(zuEntwerten) })

    if (fragtAlle) AndereEntwertenFrage(zustand,
        onSchliessen = { fragtAlle = false },
        onEntwerten = { fragtAlle = false; onRevokeOthers() })
}

/** Ein angemeldetes Gerät: Bezeichnung, Marken, Daten und, ausser beim eigenen, Aussperren. */
@Composable
private fun GeraetZeile(g: GeraetAnsicht, onEntwerten: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(g.bezeichnung, fontWeight = FontWeight.SemiBold)
                if (g.aktuell) Surface(
                    shape = Formen.chip,
                    color = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Text(stringResource(R.string.tokens_current),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar))
                }
                // Ein Zugang mit Verwalterrechten soll in der Liste auffallen.
                if (g.vollerZugriff) Surface(
                    shape = Formen.chip,
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                ) {
                    Text(stringResource(R.string.tokens_full_access),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar))
                }
            }
            Text(
                stringResource(R.string.tokens_row_hint,
                    fmtTag(g.angelegt) ?: "—",
                    fmtTag(g.zuletztBenutzt) ?: stringResource(R.string.tokens_unused),
                    g.laeuftAb?.let { fmtTag(it) ?: "—" } ?: stringResource(R.string.tokens_never)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!g.aktuell) MitTooltip(stringResource(R.string.tokens_revoke_title)) {
            IconButton(onClick = onEntwerten) {
                Icon(Icons.Default.Delete,
                    stringResource(R.string.tokens_revoke_title),
                    tint = MaterialTheme.colorScheme.error)
            }
        }
    }
}

/** Rückfrage vor dem Aussperren eines einzelnen Geräts. */
@Composable
private fun EntwertenFrage(zustand: GeraeteUiState, zuEntwerten: String, onSchliessen: () -> Unit, onEntwerten: () -> Unit) {
    AlertDialog(
        onDismissRequest = onSchliessen,
        title = { Text(stringResource(R.string.tokens_revoke_title)) },
        text = {
            Ueberdeckungsschutz()
            Text(stringResource(R.string.tokens_revoke_text,
                zustand.geraete.firstOrNull { it.tokenId == zuEntwerten }?.bezeichnung ?: "—"))
        },
        confirmButton = {
            TextButton(onClick = onEntwerten) {
                Text(stringResource(R.string.tokens_revoke_confirm),
                     color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onSchliessen) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}

/** Rückfrage vor dem Aussperren aller anderen Geräte. */
@Composable
private fun AndereEntwertenFrage(zustand: GeraeteUiState, onSchliessen: () -> Unit, onEntwerten: () -> Unit) {
    AlertDialog(
        onDismissRequest = onSchliessen,
        title = { Text(stringResource(R.string.tokens_revoke_others_title)) },
        text = {
            Ueberdeckungsschutz()
            val betroffen = zustand.geraete.count { !it.aktuell }
            Text(pluralStringResource(
                R.plurals.tokens_revoke_others_text, betroffen, betroffen))
        },
        confirmButton = {
            TextButton(onClick = onEntwerten) {
                Text(stringResource(R.string.tokens_revoke_confirm),
                     color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onSchliessen) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}
