package ch.brickinventoryapp.data

import ch.brickinventoryapp.dataapi.collection.SetCreateStep
import ch.brickinventoryapp.dataapi.collection.SetCreator
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.OfflineStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject

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
