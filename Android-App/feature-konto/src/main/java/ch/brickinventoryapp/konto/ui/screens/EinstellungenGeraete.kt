package ch.brickinventoryapp.konto.ui.screens

import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.konto.ui.GeraeteUiState
import ch.brickinventoryapp.model.ui.model.GeraetAnsicht
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.PasswortRueckfrage
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.ui.components.SettingsCard

/**
 * Angemeldete Geräte: die ausgestellten Zugänge sehen und aussperren.
 * Der eigene Zugang hat keinen Knopf: Wer ihn entwertet, meldet sich selbst ab, und dafür gibt es
 * Abmelden.
 */
@Composable
internal fun GeraeteCard(
    zustand: GeraeteUiState,
    onReload: () -> Unit,
    onFrage: (tokenId: String?) -> Unit,
    onBestaetigen: (passwort: String, code: String?) -> Unit,
    onAbbrechen: () -> Unit,
) {
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
                    GeraetZeile(g, onEntwerten = { onFrage(g.tokenId) })
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
                    onClick = { onFrage(null) },
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    border = nebenKnopfRand(),
                ) { Text(stringResource(R.string.tokens_revoke_others)) }
            }
        }
    }

    // Rückfrage mit Passwort: Ein Zugang, der weg ist, kommt nicht wieder, und
    // ein erbeuteter Zugang allein soll die anderen nicht abmelden können.
    val frage = zustand.rueckfrage
    if (frage != null) {
        val betroffen = zustand.geraete.count { !it.aktuell }
        PasswortRueckfrage(
            titel = stringResource(if (frage.tokenId == null) R.string.tokens_revoke_others_title else R.string.tokens_revoke_title),
            text = if (frage.tokenId == null) pluralStringResource(R.plurals.tokens_revoke_others_text, betroffen, betroffen)
                   else stringResource(R.string.tokens_revoke_text,
                       zustand.geraete.firstOrNull { it.tokenId == frage.tokenId }?.bezeichnung ?: "—"),
            bestaetigen = stringResource(R.string.tokens_revoke_confirm),
            codeNoetig = frage.codeNoetig, fehler = frage.fehler, laeuft = frage.laeuft,
            onBestaetigen = onBestaetigen,
            onAbbrechen = onAbbrechen,
        )
    }
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
