package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.offline.Offlineablage
import javax.inject.Inject

/** What must disappear of the account's data at sign-out: local compartments and outbox. */
internal fun interface AccountDataDeleter {
    suspend fun deleteAccountData()
}

/**
 * Local compartments and outbox belong to the signed-in account. What is still waiting
 * in the outbox gets lost in the process — another account must not send it.
 */
internal class AccountDataDeletion @Inject constructor(
    private val ablage: Offlineablage,
) : AccountDataDeleter {
    override suspend fun deleteAccountData() {
        ablage.leere()
    }
}
