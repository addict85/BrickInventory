package ch.brickinventoryapp.dataapi.collection

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetRecorded
import kotlinx.coroutines.flow.Flow

/**
 * Create a set and follow the server's steps along the way. On the device
 * via the event stream ([SetCreateSseClient]); the interface lets
 * adding be checked without network and settings.
 */
interface SetCreator {
    fun create(
        setNumber: String, quantity: Int, purchasePrice: Money?,
        condition: Condition?, ownerUserId: Int?, storage: String? = null,
    ): Flow<SetCreateStep>
}

/** What the server reports during creation; the last step is Done, Failure or NoConnection. */
sealed class SetCreateStep {
    data class MasterData(val name: String?) : SetCreateStep()
    object Image : SetCreateStep()
    object FastDone : SetCreateStep()
    data class Done(val outcome: SetRecorded) : SetCreateStep()
    /** The server's sentence; empty: the stream broke off, whether the set was created is open. */
    data class Failure(val message: String) : SetCreateStep()
    /** No connection established — the request never reached the server. */
    object NoConnection : SetCreateStep()
}
