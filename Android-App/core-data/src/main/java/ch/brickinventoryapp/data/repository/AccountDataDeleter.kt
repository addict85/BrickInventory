package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.offline.Offlineablage
import javax.inject.Inject

/** Was beim Abmelden von den Daten des Kontos verschwinden muss: lokale Fächer und Ausgang. */
internal fun interface AccountDataDeleter {
    suspend fun deleteAccountData()
}

/**
 * Lokale Fächer und Ausgang gehören dem angemeldeten Konto. Was noch im
 * Ausgang wartet, geht dabei verloren — ein anderes Konto darf es nicht senden.
 */
internal class AccountDataDeletion @Inject constructor(
    private val ablage: Offlineablage,
) : AccountDataDeleter {
    override suspend fun deleteAccountData() {
        ablage.leere()
    }
}
