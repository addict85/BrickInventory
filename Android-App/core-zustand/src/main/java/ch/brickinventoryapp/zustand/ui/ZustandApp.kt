package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.model.data.model.*

/**
 * CSV-Import-Fortschritt — eigener Fluss, weil er während eines Imports alle 1.5 s
 * wechselt; so zeichnet nur der Banner neu.
 */
data class CsvImportUiState(
    val running: Boolean = false,
    val done: Int = 0,
    val total: Int = 0,
    val current: String? = null,
    val ok: Int = 0,
    val warn: Int = 0,
    val err: Int = 0,
)
