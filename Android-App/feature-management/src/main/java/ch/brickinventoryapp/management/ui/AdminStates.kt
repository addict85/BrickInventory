package ch.brickinventoryapp.management.ui

import ch.brickinventoryapp.model.domain.LogRowView
import ch.brickinventoryapp.uistate.Load

/**
 * The server log — its own state for admins: exactly one screen reads
 * it. The rows stay up while a different period is being fetched.
 */
data class ManagementUiState(
    val log: List<LogRowView> = emptyList(),
    /** Log time span in minutes — the server caps it at 2880. */
    val logMinutes: Int = 15,
    val fetch: Load<Unit> = Load.Data(Unit),
)
