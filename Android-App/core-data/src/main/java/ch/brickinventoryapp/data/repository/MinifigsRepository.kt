package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Erfasst
import ch.brickinventoryapp.model.domain.Kontoauswahl
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.domain.FigurAnsicht
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.UsageView
import kotlinx.coroutines.flow.Flow

/**
 * Minifigures: stock and manually added figures.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (FigurenRepositoryImpl).
 */
interface MinifigsRepository {
    /** The figures from the store by search text; [refreshMinifigs] fills them. */
    fun observeMinifigs(suche: String? = null): Flow<Local<FigurAnsicht>>

    fun observeManualMinifigs(suche: String? = null): Flow<Local<ManualMinifigView>>

    /** Set figures and manual figures into the store; the store is shown. */
    suspend fun refreshMinifigs(): Ergebnis<Unit>

    /** The saved location, as with PartsRepository.setPartStorage. */
    suspend fun setFigStorage(figNumber: String, ort: String): Ergebnis<String?>

    suspend fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1,
                           unitPrice: Geld? = null, condition: Zustand? = null,
                           ownerUserId: Int? = null,
                           storage: String? = null): Ergebnis<Erfasst>

    suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: Zustand? = null, owner: Int? = null): Ergebnis<Unit>

    suspend fun deleteMinifig(figNumber: String, owner: Int? = null): Ergebnis<Unit>

    suspend fun getMinifigStats(konten: Kontoauswahl? = null): Ergebnis<MinifigsMetricsView>

    suspend fun getSetsWithMinifig(figNumber: String,
                                konten: Kontoauswahl? = null): Ergebnis<UsageView>
}
