package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.BarcodeView
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.contract.mapping.alsAnsicht

import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.model.domain.FigurAnsicht
import ch.brickinventoryapp.model.domain.TeilAnsicht
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Information about a set when adding and looking up: does it exist already, what
 * is in it, which set carries this barcode. None of it lies in the
 * store — they are questions to the server, not lists of the account.
 */
interface SetKatalogRepository {
    /**
     * Is the set already in view? The number under which it stands, otherwise null; the
     * rule (normalization, household) lies with the server.
     */
    suspend fun getSetExists(setNumber: String): Ergebnis<String?>

    suspend fun getSetDetail(setNumber: String): Ergebnis<SetAnsicht?>

    /** Set name from the common catalog, also for foreign sets. */
    suspend fun getSetInfo(setNumber: String): Ergebnis<String?>

    /** The parts of a set from the catalog, one row per part and color. */
    suspend fun getSetPartsList(setNumber: String): Ergebnis<List<TeilAnsicht>>

    suspend fun getSetMinifigsList(setNumber: String): Ergebnis<List<FigurAnsicht>>

    suspend fun resolveBarcode(barcode: String): Ergebnis<BarcodeView>
}

@Singleton
class SetCatalogRepositoryImpl @Inject constructor(private val api: SetsApi) : SetKatalogRepository {
    override suspend fun getSetExists(setNumber: String) =
        sicherAufrufen { api.getSetExists(setNumber) }.shown { r -> r.setNumber.takeIf { r.exists } }

    override suspend fun getSetDetail(setNumber: String) = sicherAufrufen { api.getSetDetail(setNumber) }.shown { it.set?.alsAnsicht() }

    override suspend fun getSetInfo(setNumber: String) = sicherAufrufen { api.getSetInfo(setNumber) }.shown { it.name }

    override suspend fun getSetPartsList(setNumber: String) = sicherAufrufen { api.getSetPartsList(setNumber) }
        .promised({ it.success }, { it.error }) { r -> r.parts.map { it.alsAnsicht() } }

    override suspend fun getSetMinifigsList(setNumber: String) = sicherAufrufen { api.getSetMinifigsList(setNumber) }
        .promised({ it.success }, { it.error }) { r -> r.figs.map { it.alsAnsicht() } }

    override suspend fun resolveBarcode(barcode: String) = sicherAufrufen { api.getBarcodeSet(barcode) }.shown {
        BarcodeView(it.setNumber, it.name, it.year, it.pieces, it.theme, it.minifigs, it.imageUrl, it.imageLocal, it.unsicher)
    }
}
