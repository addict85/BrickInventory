package ch.brickinventoryapp.app.ui.components

import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.readAloudAs
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Spacing
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Error
import ch.brickinventoryapp.ui.theme.LocalStatusColors
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.withFont

@Composable
fun CsvImportBanner(
    done: Int, total: Int, current: String?,
    ok: Int, warn: Int, err: Int, running: Boolean,
    /**
     * Cancel — visible only while the import runs.
     *
     * The web app has always had the button (collection.js, btn-cancel-import).
     * The app showed the same bar and no way out: an accidentally
     * started import of hundreds of sets fetches the master data for each and
     * had to be sat out.
     */
    onCancel: () -> Unit,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val bg  = if (running) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondaryContainer
    // The expander names what it does and whether it is open (TalkBack only read “3/10, button”).
    val condition = stringResource(if (expanded) R.string.state_expanded else R.string.state_collapsed)
    val progress = pluralStringResource(R.plurals.csv_progress, total, done, total)
    // Announced in steps of ten, not for every set.
    val level = if (total > 0) done * ANNOUNCEMENT_LEVELS / total else 0
    val announced = remember(level, running) { progress }
    val target = stringResource(if (expanded) R.string.csv_details_hide else R.string.csv_details_show)

    Column {
        Surface(
            color = bg,
            modifier = Modifier.fillMaxWidth()
                .clickable(role = Role.Button, onClickLabel = target) {
                    expanded = !expanded
                }
                .semantics {
                    stateDescription = condition
                    if (expanded) collapse { expanded = false; true } else expand { expanded = true; true }
                }
        ) {
            Column(Modifier.padding(horizontal = Spacing.large, vertical = Spacing.small)) {
                CsvHeaderRow(done, total, ok, running, expanded, progress, onCancel)
                if (running && current != null) {
                    Text(
                        current,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.padding(top = Spacing.hairline)
                    )
                }
            }
        }
        // Outside the button: otherwise the whole bar would become a live region and announce every set.
        if (running) Box(Modifier.announce().semantics { contentDescription = announced })
        if (expanded) CsvImportNumbers(ok, warn, err, running)
    }
}

/** Header row of the bar: progress, cancel and the expander's arrow. */
@Composable
private fun CsvHeaderRow(
    done: Int, total: Int, ok: Int, running: Boolean, expanded: Boolean, progress: String, onCancel: () -> Unit,
) {
    val pct = if (total > 0) done.toFloat() / total else 0f
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.small)
    ) {
        Icon(Icons.Default.UploadFile, null, Modifier.size(withFont(16.dp)),
            tint = if (running) MaterialTheme.colorScheme.onPrimary
                   else MaterialTheme.colorScheme.onSecondaryContainer)
        LinearProgressIndicator(
            progress = { pct },
            modifier = Modifier.weight(1f).height(6.dp).clip(MaterialTheme.shapes.small)
                .semantics { progressBarRangeInfo = ProgressBarRangeInfo(done.toFloat(), 0f..total.toFloat().coerceAtLeast(1f)) },
            color = if (running) MaterialTheme.colorScheme.onPrimary
                    else MaterialTheme.colorScheme.primary,
            trackColor = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.25f)
        )
        Text(
            if (running) "$done/$total" else stringResource(R.string.csv_ok_count, ok),
            modifier = if (running) Modifier.readAloudAs(progress) else Modifier,
            style = MaterialTheme.typography.bodySmall,
            color = if (running) MaterialTheme.colorScheme.onPrimary
                    else MaterialTheme.colorScheme.onSecondaryContainer,
            fontWeight = FontWeight.Bold
        )
        // In the HEADER row, not in the expanded part: whoever
        // wants to cancel should not first have to find out
        // that the bar can be expanded. In the web app
        // the button is permanently there as well.
        if (running) {
            // Full 48 dp: the bar becomes a bit taller, but in return
            // one hits Cancel even on the move.
            WithTooltip(stringResource(R.string.csv_cancel)) {
                IconButton(onClick = onCancel) {
                    Icon(Icons.Default.Close, stringResource(R.string.csv_cancel),
                        Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onPrimary)
                }
            }
        }
        Text(
            if (expanded) "▴" else "▾",
            modifier = Modifier.clearAndSetSemantics {},
            color = if (running) MaterialTheme.colorScheme.onPrimary
                    else MaterialTheme.colorScheme.onSecondaryContainer
        )
    }
}

/** Expanded: successes, warnings and errors individually, after the run with “done”. */
@Composable
private fun CsvImportNumbers(ok: Int, warn: Int, err: Int, running: Boolean) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            Modifier.padding(horizontal = Spacing.large, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(Spacing.large)
        ) {
            val colors = LocalStatusColors.current
            listOf(
                Triple(ok, Icons.Default.CheckCircle to colors.success, stringResource(R.string.csv_stat_success)),
                Triple(warn, Icons.Default.Warning to colors.warning, stringResource(R.string.csv_stat_warnings)),
                Triple(err, Icons.Default.Error to colors.error, stringResource(R.string.csv_stat_errors))
            ).forEach { (v, symbol, l) ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
                        Icon(symbol.first, null, Modifier.size(withFont(16.dp)), tint = symbol.second)
                        Text("$v", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                    }
                    Text(l, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (!running) {
                Spacer(Modifier.weight(1f))
                Text(
                    stringResource(R.string.csv_import_done),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.CenterVertically)
                )
            }
        }
    }
}

/** Ten announcements over a whole import. */
private const val ANNOUNCEMENT_LEVELS = 10
