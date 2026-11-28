package ch.brickinventoryapp.data.catalog

import ch.brickinventoryapp.model.domain.BarcodeView
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.outcome.Outcome

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
