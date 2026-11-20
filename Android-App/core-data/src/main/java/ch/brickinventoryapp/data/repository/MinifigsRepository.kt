package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Erfasst
import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Local
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.MinifigsMetricsView
import ch.brickinventoryapp.model.fach.ManualMinifigView
import ch.brickinventoryapp.model.fach.UsageView
import kotlinx.coroutines.flow.Flow

/**
 * Minifiguren: Bestand und manuell erfasste Figuren.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (FigurenRepositoryImpl).
 */
interface MinifigsRepository {
    /** Die Figuren aus der Ablage nach dem Suchtext; [refreshMinifigs] füllt sie. */
    fun observeMinifigs(suche: String? = null): Flow<Local<FigurAnsicht>>

    fun observeManualMinifigs(suche: String? = null): Flow<Local<ManualMinifigView>>

    /** Set-Figuren und manuelle Figuren in die Ablage; gezeigt wird die Ablage. */
    suspend fun refreshMinifigs(): Ergebnis<Unit>

    /** Der gespeicherte Ort, wie bei PartsRepository.setPartStorage. */
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
