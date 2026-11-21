package ch.brickinventoryapp.management.ui

import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.LogRowView

/**
 * The server log — its own state for admins: exactly one screen reads
 * it. The rows stay up while a different period is being fetched.
 */
data class ManagementUiState(
    val protokoll: List<LogRowView> = emptyList(),
    /** Log time span in minutes — the server caps it at 2880. */
    val logMinutes: Int = 15,
    val abruf: Laden<Unit> = Laden.Daten(Unit),
)
