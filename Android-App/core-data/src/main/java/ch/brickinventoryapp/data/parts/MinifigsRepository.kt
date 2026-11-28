package ch.brickinventoryapp.data.parts

import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.AccountSelection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.Recorded
import ch.brickinventoryapp.model.domain.UsageView
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow

/**
 * Minifigures: stock and manually added figures.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (MinifigsRepositoryImpl).
 */
interface MinifigsRepository {
    /** The figures from the store by search text; [refreshMinifigs] fills them. */
    fun observeMinifigs(search: String? = null): Flow<Local<FigureView>>

    fun observeManualMinifigs(search: String? = null): Flow<Local<ManualMinifigView>>

    /** Set figures and manual figures into the store; the store is shown. */
    suspend fun refreshMinifigs(): Outcome<Unit>

    /** The saved location, as with PartsRepository.setPartStorage. */
    suspend fun setFigStorage(figNumber: String, location: String): Outcome<String?>

    suspend fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1,
                           unitPrice: Money? = null, condition: Condition? = null,
                           ownerUserId: Int? = null,
                           storage: String? = null): Outcome<Recorded>

    suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: Condition? = null, owner: Int? = null): Outcome<Unit>

    suspend fun deleteMinifig(figNumber: String, owner: Int? = null): Outcome<Unit>

    suspend fun getMinifigStats(accounts: AccountSelection? = null): Outcome<MinifigsMetricsView>

    suspend fun getSetsWithMinifig(figNumber: String,
                                accounts: AccountSelection? = null): Outcome<UsageView>
}
