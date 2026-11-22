package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.OfflineStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject

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

/** What the server reports during creation; the last step is Fertig, Fehler or NoConnection. */
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

/**
 * Creating via the event stream updates the store like every other
 * write path: the gallery shows the set as soon as the server reports „done“.
 */
internal class CreateWithStore @Inject constructor(
    private val stream: SetCreateSseClient,
    private val store: OfflineStore,
) : SetCreator {
    override fun create(
        setNumber: String, quantity: Int, purchasePrice: Money?,
        condition: Condition?, ownerUserId: Int?, storage: String?,
    ): Flow<SetCreateStep> = flow {
        val before = store.area()
        stream.create(setNumber, quantity, purchasePrice, condition, ownerUserId, storage).collect { s ->
            val e = (s as? SetCreateStep.Done)?.outcome
            if (e != null && !e.present && before != null && store.area() == before) {
                val number = e.number ?: setNumber
                store.applyChange(Editing.RecordSet(EntryRequest(setNumber = number, quantity = quantity, purchasePrice = purchasePrice,
                    condition = condition, owner = ownerUserId, storageLocation = storage)), before)
            }
            emit(s)
        }
    }
}
