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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.management.ui.viewmodel.BackgroundUiState
import ch.brickinventoryapp.model.domain.JobView
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.AppCard
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.fmtTag

/**
 * The background work from the job table, as in the web app. The
 * warning about no job process stands at the top: without it none of the
 * jobs below it moves, and that should not have to be guessed from static numbers.
 */
@Composable
internal fun BackgroundSection(
    condition: BackgroundUiState,
    startOn: (kind: String, name: String) -> Unit,
    clearOn: (kind: String) -> Unit,
    onCancel: (id: String) -> Unit,
    retryOn: (id: String) -> Unit,
) {
    val view = condition.view
    AppCard {
        Column(Modifier.padding(Spacing.large), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
            // „Aufträge“, not the page name again: it already stands above.
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                SectionTitle(stringResource(R.string.background_jobs))
                if (condition.fetch.loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            }
            condition.fetch.errorMessage?.let { Text(it.sentence(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            if (view != null && !view.jobProcessRunning) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
                    Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    Text(stringResource(R.string.background_no_process), color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (view == null) return@Column
            for (p in view.pauses) {
                Text(stringResource(R.string.background_pause, jobKindText(p.kind)?.let { stringResource(it) } ?: p.kind,
                    fmtTag(p.until) ?: "—", p.reason), style = MaterialTheme.typography.bodySmall)
            }
            if (view.imageDemand > 0) Text(pluralStringResource(R.plurals.background_image_demand,
                view.imageDemand, view.imageDemand), style = MaterialTheme.typography.bodySmall)
            if (view.jobs.isEmpty()) {
                Text(stringResource(R.string.background_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            for ((kind, group) in view.jobs.groupBy { it.kind }) {
                JobGroup(kind, group, startOn, clearOn, onCancel, retryOn)
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
    kind: String,
    group: List<JobView>,
    startOn: (kind: String, name: String) -> Unit,
    clearOn: (kind: String) -> Unit,
    onCancel: (id: String) -> Unit,
    retryOn: (id: String) -> Unit,
) {
    HorizontalDivider()
    val name = jobKindText(kind)?.let { stringResource(it) } ?: kind
    var clearAsk by rememberSaveable(kind) { mutableStateOf(false) }
    if (clearAsk) {
        Prompt(
            title = stringResource(R.string.background_clear_title),
            text = stringResource(R.string.background_clear_text, name),
            confirm = stringResource(R.string.background_clear),
            onConfirm = { clearAsk = false; clearOn(kind) },
            onCancel = { clearAsk = false },
        )
    }
    val nowName = stringResource(R.string.background_now_cd, name)
    val clearName = stringResource(R.string.background_clear_cd, name)
    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
        Text(name, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        TextButton(onClick = { startOn(kind, name) }, modifier = Modifier.semantics { contentDescription = nowName }) {
            Text(stringResource(R.string.background_now))
        }
        TextButton(onClick = { clearAsk = true }, modifier = Modifier.semantics { contentDescription = clearName }) {
            Text(stringResource(R.string.background_clear))
        }
    }
    for (a in group) JobRow(a, name,
        onCancel = { onCancel(a.id) },
        retryOn = { retryOn(a.id) })
}

/** A job; its buttons are called „Auftrag abbrechen“, not „Abbrechen“ as in every other dialog. */
@Composable
private fun JobRow(a: JobView, kindName: String, onCancel: () -> Unit, retryOn: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            val header = listOfNotNull(
                a.status.statusText?.let { stringResource(it) },
                a.setNumber,
                a.progressText,
                if (a.attempt > 1) stringResource(R.string.background_attempt, a.attempt, a.maxAttempts) else null,
            ).joinToString(" · ")
            Text(header, style = MaterialTheme.typography.bodyMedium)
            a.dueFrom?.let { time ->
                Text(stringResource(if (a.scheduled) R.string.background_scheduled else R.string.background_due,
                    fmtTag(time) ?: time), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            a.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        }
        val who = listOfNotNull(kindName, a.setNumber).joinToString(" ")
        if (a.cancellable) JobButton(stringResource(R.string.background_cancel), who, onCancel)
        if (a.retryable) JobButton(stringResource(R.string.background_job_retry), who, retryOn)
    }
}

/** A button on a job; read out with kind and set („Auftrag abbrechen: Bilder eines Sets 75192-1“). */
@Composable
private fun JobButton(action: String, who: String, onClick: () -> Unit) {
    val name = stringResource(R.string.action_for, action, who)
    TextButton(onClick = onClick, modifier = Modifier.semantics { contentDescription = name }) { Text(action) }
}
