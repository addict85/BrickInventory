package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.model.AuftragAnsicht
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.util.fmtDatum
import kotlinx.coroutines.launch

/**
 * Die Hintergrundarbeiten aus der Auftragstabelle, wie in der Webapp. Die
 * Warnung ohne Job-Prozess steht oben: Ohne ihn bewegt sich keiner der
 * Aufträge darunter, und das soll man nicht aus stehenden Zahlen erraten müssen.
 */
@Composable
internal fun HintergrundSection(mon: MonitoringViewModel, onSnack: (String) -> Unit) {
    val zustand by mon.hintergrund.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val ansicht = zustand.ansicht
    AppKarte {
        Column(Modifier.padding(Abstaende.gross), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Text(stringResource(R.string.hintergrund_titel),
                    fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                if (zustand.laedt) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            }
            zustand.fehler?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            if (ansicht != null && !ansicht.jobProzessLaeuft) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    Text(stringResource(R.string.hintergrund_kein_prozess), color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (ansicht == null) return@Column
            for (p in ansicht.pausen) {
                Text(stringResource(R.string.hintergrund_pause, p.artText?.let { stringResource(it) } ?: p.art,
                    fmtDatum(p.bis) ?: "—", p.grund), style = MaterialTheme.typography.bodySmall)
            }
            if (ansicht.bildbedarf > 0) Text(pluralStringResource(R.plurals.hintergrund_bildbedarf,
                ansicht.bildbedarf, ansicht.bildbedarf), style = MaterialTheme.typography.bodySmall)
            if (ansicht.auftraege.isEmpty()) {
                Text(stringResource(R.string.hintergrund_leer), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            for ((art, gruppe) in ansicht.auftraege.groupBy { it.art }) {
                HorizontalDivider()
                val name = gruppe.first().artText?.let { stringResource(it) } ?: art
                Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                    Text(name, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    TextButton(onClick = { scope.launch { onSnack(mon.starteAuftragsArt(art, name)) } }) {
                        Text(stringResource(R.string.hintergrund_jetzt))
                    }
                    TextButton(onClick = { scope.launch { onSnack(mon.leereAuftragsArt(art)) } }) {
                        Text(stringResource(R.string.hintergrund_leeren))
                    }
                }
                for (a in gruppe) AuftragZeile(a,
                    onAbbrechen = { scope.launch { onSnack(mon.brichAuftragAb(a.id)) } },
                    onWiederholen = { scope.launch { onSnack(mon.wiederholeAuftrag(a.id)) } })
            }
        }
    }
}

@Composable
private fun AuftragZeile(a: AuftragAnsicht, onAbbrechen: () -> Unit, onWiederholen: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            val kopf = listOfNotNull(
                a.status.text?.let { stringResource(it) },
                a.setNumber,
                a.fortschrittText,
                if (a.versuch > 1) stringResource(R.string.hintergrund_versuch, a.versuch, a.maxVersuche) else null,
            ).joinToString(" · ")
            Text(kopf, style = MaterialTheme.typography.bodyMedium)
            a.faelligAb?.let { zeit ->
                Text(stringResource(if (a.geplant) R.string.hintergrund_geplant else R.string.hintergrund_faellig,
                    fmtDatum(zeit) ?: zeit), style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            a.fehler?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
        }
        if (a.abbrechbar) TextButton(onClick = onAbbrechen) { Text(stringResource(R.string.hintergrund_abbrechen)) }
        if (a.wiederholbar) TextButton(onClick = onWiederholen) { Text(stringResource(R.string.hintergrund_wiederholen)) }
    }
}
