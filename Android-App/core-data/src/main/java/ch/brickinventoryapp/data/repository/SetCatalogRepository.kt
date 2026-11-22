package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.model.domain.BarcodeView
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.SetView
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Information about a set when adding and looking up: does it exist already, what
 * is in it, which set carries this barcode. None of it lies in the
 * store — they are questions to the server, not lists of the account.
 */
interface SetCatalogRepository {
    /**
     * Is the set already in view? The number under which it stands, otherwise null; the
     * rule (normalization, household) lies with the server.
     */
    suspend fun getSetExists(setNumber: String): Outcome<String?>

    suspend fun getSetDetail(setNumber: String): Outcome<SetView?>

    /** Set name from the common catalog, also for foreign sets. */
    suspend fun getSetInfo(setNumber: String): Outcome<String?>

    /** The parts of a set from the catalog, one row per part and color. */
    suspend fun getSetPartsList(setNumber: String): Outcome<List<PartView>>

    suspend fun getSetMinifigsList(setNumber: String): Outcome<List<FigureView>>

    suspend fun resolveBarcode(barcode: String): Outcome<BarcodeView>
}

@Singleton
class SetCatalogRepositoryImpl @Inject constructor(private val api: SetsApi) : SetCatalogRepository {
    override suspend fun getSetExists(setNumber: String) =
        safeCall { api.getSetExists(setNumber) }.mapData { r -> r.setNumber.takeIf { r.exists } }

    override suspend fun getSetDetail(setNumber: String) = safeCall { api.getSetDetail(setNumber) }.mapData { it.set?.asView() }

    override suspend fun getSetInfo(setNumber: String) = safeCall { api.getSetInfo(setNumber) }.mapData { it.name }

    override suspend fun getSetPartsList(setNumber: String) = safeCall { api.getSetPartsList(setNumber) }
        .promised({ it.success }, { it.error }) { r -> r.parts.map { it.asView() } }

    override suspend fun getSetMinifigsList(setNumber: String) = safeCall { api.getSetMinifigsList(setNumber) }
        .promised({ it.success }, { it.error }) { r -> r.figs.map { it.asView() } }

    override suspend fun resolveBarcode(barcode: String) = safeCall { api.getBarcodeSet(barcode) }.mapData {
        BarcodeView(it.setNumber, it.name, it.year, it.pieces, it.theme, it.minifigs, it.imageUrl, it.imageLocal, it.unsicher)
    }
}
