package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.model.ui.Operation

/**
 * CSV import progress — its own flow, because it changes every 1.5 s during an import;
 * that way only the banner redraws.
 */
data class CsvImportUiState(
    /** The import on the server; [err] counts its errors. */
    val jobRun: Operation = Operation.Done,
    val done: Int = 0,
    val total: Int = 0,
    val current: String? = null,
    val ok: Int = 0,
    val warn: Int = 0,
    val err: Int = 0,
)
