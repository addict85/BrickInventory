package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Erfasst
import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.ui.model.FigurAnsicht
import ch.brickinventoryapp.model.ui.model.FigurenKennzahlenAnsicht
import ch.brickinventoryapp.model.ui.model.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.ui.model.VerwendungAnsicht
import kotlinx.coroutines.flow.Flow

/**
 * Minifiguren: Bestand und manuell erfasste Figuren.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (FigurenRepositoryImpl).
 */
interface FigurenRepository {
    /** Die Figuren aus der Ablage nach dem Suchtext; [aktualisiereFiguren] füllt sie. */
    fun beobachteFiguren(suche: String? = null): Flow<Lokal<FigurAnsicht>>

    fun beobachteManuelleFiguren(suche: String? = null): Flow<Lokal<ManuelleFigurAnsicht>>

    /** Set-Figuren und manuelle Figuren in die Ablage; gezeigt wird die Ablage. */
    suspend fun aktualisiereFiguren(): Ergebnis<Unit>

    /** Der gespeicherte Ort, wie bei TeileRepository.setPartStorage. */
    suspend fun setFigStorage(figNumber: String, ort: String): Ergebnis<String?>

    suspend fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1,
                           unitPrice: Double? = null, condition: Zustand? = null,
                           ownerUserId: Int? = null,
                           storage: String? = null): Ergebnis<Erfasst>

    suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: Zustand? = null, owner: Int? = null): Ergebnis<Unit>

    suspend fun deleteMinifig(figNumber: String, owner: Int? = null): Ergebnis<Unit>

    suspend fun getMinifigStats(konten: Kontoauswahl? = null): Ergebnis<FigurenKennzahlenAnsicht>

    suspend fun getSetsMitFigur(figNumber: String,
                                konten: Kontoauswahl? = null): Ergebnis<VerwendungAnsicht>
}
