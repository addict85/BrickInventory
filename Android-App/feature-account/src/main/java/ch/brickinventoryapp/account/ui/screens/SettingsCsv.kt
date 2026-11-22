package ch.brickinventoryapp.account.ui.screens

import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.ui.sentence
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import ch.brickinventoryapp.ui.components.Section
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.title
import kotlinx.coroutines.launch
import ch.brickinventoryapp.account.ui.CsvUploadUiState
import ch.brickinventoryapp.model.domain.CsvImportKind
import ch.brickinventoryapp.account.ui.viewmodel.CSV_MAX_BYTES

/**
 * Upload a CSV file — sets, parts, minifigures, watchlist or price alerts,
 * via the same addresses as the web app. The progress afterward comes over the
 * existing channel: the import keeps running on the server even if the app
 * is closed.
 */
@Composable
internal fun CsvImportCard(
    csvState: CsvUploadUiState,
    onFile: (CsvImportKind, android.net.Uri) -> Unit,
    onClose: () -> Unit,
) {
    // Which kind was meant by the tap — the file picker contract only delivers the
    // Uri, not the button. rememberSaveable, not remember: the file picker is
    // a foreign app, and the system may kill this process while it runs;
    // if the value fell back to SETS, a parts file would end up in the wrong table.
    var selectedKind by rememberSaveable { mutableStateOf(CsvImportKind.SETS) }
    val selection = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
    ) { uri -> if (uri != null) onFile(selectedKind, uri) }

    // `text/*` AND `text/comma-separated-values`: some file managers
    // give a .csv the type `application/vnd.ms-excel`, others none at all.
    // Filtered too tightly, the file would be grayed out in the picker with
    // no way to tell why.
    val types = arrayOf("text/csv", "text/comma-separated-values", "text/plain",
                        "application/vnd.ms-excel", "application/octet-stream")

    Text(
        stringResource(R.string.csv_upload_hint,
            (CSV_MAX_BYTES / 1024 / 1024).toInt()),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)

    Section(title = null, innerGap = false) {
        listOf(
            CsvKind(CsvImportKind.SETS, R.string.csv_upload_sets, R.string.csv_desc_sets, R.string.csv_format_sets),
            CsvKind(CsvImportKind.PARTS, R.string.csv_upload_parts, R.string.csv_desc_parts, R.string.csv_format_parts),
            CsvKind(CsvImportKind.MINIFIGS, R.string.csv_upload_figs, R.string.csv_desc_figs, R.string.csv_format_figs),
            CsvKind(CsvImportKind.WANTED_LIST, R.string.csv_upload_wanted, R.string.csv_desc_wanted, R.string.csv_format_wanted),
            CsvKind(CsvImportKind.PRICE_ALARMS, R.string.csv_upload_alerts, R.string.csv_desc_alerts, R.string.csv_format_alerts),
        ).forEachIndexed { i, (kind, title, content, columns) ->
            if (i > 0) HorizontalDivider()
            ListItem(
                headlineContent = { Text(stringResource(title)) },
                // What's inside, in German first; the file's column names quieter below
                // for whoever creates it by hand. Raw, they read like program code.
                supportingContent = {
                    Column {
                        Text(stringResource(content), style = MaterialTheme.typography.bodySmall)
                        Text(stringResource(columns), style = MaterialTheme.typography.bodySmall,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                leadingContent = { Icon(Icons.Default.UploadFile, null, tint = MaterialTheme.colorScheme.primary) },
                // The spinner sits on the row whose import is running — the others stay still.
                trailingContent = if (csvState.upload.running && csvState.kind == kind) {
                    { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
                } else null,
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable(enabled = !csvState.upload.running, role = Role.Button) {
                    selectedKind = kind; selection.launch(types)
                }.alpha(if (csvState.upload.running && csvState.kind != kind) 0.6f else 1f),
            )
        }
    }
    CsvFeedback(csvState, onClose)
}

/** What the last import brought in, or why it failed; either can be collapsed. */
@Composable
private fun CsvFeedback(csvState: CsvUploadUiState, onClose: () -> Unit) {
    val outcome = csvState.outcome
    if (outcome != null) {
        Text(
            // Four numbers, in English two of them coincide ("row/rows",
            // "error/errors"). A <plurals> only matches one, hence four
            // fragments in one frame — also "new" and "updated", so the frame
            // carries no %d that Lint would flag.
            stringResource(R.string.csv_upload_result,
                pluralStringResource(R.plurals.csv_upload_rows, outcome.total, outcome.total),
                pluralStringResource(R.plurals.csv_upload_new, outcome.newCreated, outcome.newCreated),
                pluralStringResource(R.plurals.csv_upload_updated, outcome.updated, outcome.updated),
                pluralStringResource(R.plurals.csv_upload_errors, outcome.errors, outcome.errors)),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.primary)
        TextButton(onClick = onClose) { Text(stringResource(R.string.csv_upload_close)) }
    }
    csvState.upload.errorMessage?.let { error ->
        Text(error.sentence(), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error)
        TextButton(onClick = onClose) { Text(stringResource(R.string.csv_upload_close)) }
    }
}

/** An import kind: what it is, what's inside (plain text) and what the file's columns are called. */
private data class CsvKind(
    val kind: CsvImportKind,
    val title: Int,
    val content: Int,
    val columns: Int,
)
