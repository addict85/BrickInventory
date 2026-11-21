package ch.brickinventoryapp.management.ui.screens

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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.components.Prompt
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.domain.JobView
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.management.ui.viewmodel.BackgroundUiState
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.ui.satz

/**
 * The background work from the job table, as in the web app. The
 * warning about no job process stands at the top: without it none of the
 * jobs below it moves, and that should not have to be guessed from static numbers.
 */
@Composable
internal fun BackgroundSection(
    zustand: BackgroundUiState,
    startOn: (art: String, name: String) -> Unit,
    clearOn: (art: String) -> Unit,
    onAbbrechen: (id: String) -> Unit,
    retryOn: (id: String) -> Unit,
) {
    val ansicht = zustand.ansicht
    AppKarte {
        Column(Modifier.padding(Abstaende.gross), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            // „Aufträge“, not the page name again: it already stands above.
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                SectionTitle(stringResource(R.string.hintergrund_auftraege))
                if (zustand.abruf.laedt) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            }
            zustand.abruf.errorMessage?.let { Text(it.satz(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            if (ansicht != null && !ansicht.jobProcessRunning) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    Text(stringResource(R.string.hintergrund_kein_prozess), color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (ansicht == null) return@Column
            for (p in ansicht.pausen) {
                Text(stringResource(R.string.hintergrund_pause, jobKindText(p.art)?.let { stringResource(it) } ?: p.art,
                    fmtTag(p.bis) ?: "—", p.grund), style = MaterialTheme.typography.bodySmall)
            }
            if (ansicht.bildbedarf > 0) Text(pluralStringResource(R.plurals.hintergrund_bildbedarf,
                ansicht.bildbedarf, ansicht.bildbedarf), style = MaterialTheme.typography.bodySmall)
            if (ansicht.auftraege.isEmpty()) {
                Text(stringResource(R.string.hintergrund_leer), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            for ((art, gruppe) in ansicht.auftraege.groupBy { it.art }) {
                JobGroup(art, gruppe, startOn, clearOn, onAbbrechen, retryOn)
            }
        }
    }
}

/**
 * The jobs of one kind under their header with „Jetzt“ and „Leeren“. Clearing asks first:
 * removed jobs do not come back. TalkBack reads the job kind with every button,
 * otherwise „Leeren“ would stand five times in a row.
 */
@Composable
private fun JobGroup(
    art: String,
    gruppe: List<JobView>,
    startOn: (art: String, name: String) -> Unit,
    clearOn: (art: String) -> Unit,
    onAbbrechen: (id: String) -> Unit,
    retryOn: (id: String) -> Unit,
) {
    HorizontalDivider()
    val name = jobKindText(art)?.let { stringResource(it) } ?: art
    var clearAsk by rememberSaveable(art) { mutableStateOf(false) }
    if (clearAsk) {
        Prompt(
            titel = stringResource(R.string.hintergrund_leeren_titel),
            text = stringResource(R.string.hintergrund_leeren_text, name),
            bestaetigen = stringResource(R.string.hintergrund_leeren),
            onBestaetigen = { clearAsk = false; clearOn(art) },
            onAbbrechen = { clearAsk = false },
        )
    }
    val nowName = stringResource(R.string.hintergrund_jetzt_cd, name)
    val clearName = stringResource(R.string.hintergrund_leeren_cd, name)
    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
        Text(name, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        TextButton(onClick = { startOn(art, name) }, modifier = Modifier.semantics { contentDescription = nowName }) {
            Text(stringResource(R.string.hintergrund_jetzt))
        }
        TextButton(onClick = { clearAsk = true }, modifier = Modifier.semantics { contentDescription = clearName }) {
            Text(stringResource(R.string.hintergrund_leeren))
        }
    }
    for (a in gruppe) JobRow(a, name,
        onAbbrechen = { onAbbrechen(a.id) },
        retryOn = { retryOn(a.id) })
}

/** A job; its buttons are called „Auftrag abbrechen“, not „Abbrechen“ as in every other dialog. */
@Composable
private fun JobRow(a: JobView, kindName: String, onAbbrechen: () -> Unit, retryOn: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            val kopf = listOfNotNull(
                a.status.statusText?.let { stringResource(it) },
                a.setNumber,
                a.progressText,
                if (a.attempt > 1) stringResource(R.string.hintergrund_versuch, a.attempt, a.maxVersuche) else null,
            ).joinToString(" · ")
            Text(kopf, style = MaterialTheme.typography.bodyMedium)
            a.dueAb?.let { zeit ->
                Text(stringResource(if (a.geplant) R.string.hintergrund_geplant else R.string.hintergrund_faellig,
                    fmtTag(zeit) ?: zeit), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            a.fehler?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        }
        val wer = listOfNotNull(kindName, a.setNumber).joinToString(" ")
        if (a.abbrechbar) JobButton(stringResource(R.string.hintergrund_abbrechen), wer, onAbbrechen)
        if (a.retryable) JobButton(stringResource(R.string.hintergrund_auftrag_wiederholen), wer, retryOn)
    }
}

/** A button on a job; read out with kind and set („Auftrag abbrechen: Bilder eines Sets 75192-1“). */
@Composable
private fun JobButton(aktion: String, wer: String, onClick: () -> Unit) {
    val name = stringResource(R.string.aktion_fuer, aktion, wer)
    TextButton(onClick = onClick, modifier = Modifier.semantics { contentDescription = name }) { Text(aktion) }
}
