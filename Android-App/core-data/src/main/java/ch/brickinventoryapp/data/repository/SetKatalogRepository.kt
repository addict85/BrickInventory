package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.ui.model.BarcodeAnsicht
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht

import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.vertrag.MinifigsResponse
import ch.brickinventoryapp.vertrag.PartsResponse
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Auskünfte zu einem Set beim Erfassen und Nachschlagen: gibt es das schon, was
 * steckt darin, welches Set trägt diesen Barcode. Nichts davon liegt in der
 * Ablage — es sind Fragen an den Server, keine Listen des Kontos.
 */
interface SetKatalogRepository {
    /**
     * Steht das Set schon im Blickfeld? Die Nummer, unter der es steht, sonst null; die
     * Regel (Normalisierung, Haushalt) liegt beim Server.
     */
    suspend fun getSetExists(setNumber: String): Ergebnis<String?>

    suspend fun getSetDetail(setNumber: String): Ergebnis<SetAnsicht?>

    /** Setname aus dem gemeinsamen Katalog, auch für fremde Sets. */
    suspend fun getSetInfo(setNumber: String): Ergebnis<String?>

    suspend fun getSetPartsList(setNumber: String): Ergebnis<PartsResponse>

    suspend fun getSetMinifigsList(setNumber: String): Ergebnis<MinifigsResponse>

    suspend fun resolveBarcode(barcode: String): Ergebnis<BarcodeAnsicht>
}

@Singleton
class SetKatalogRepositoryImpl @Inject constructor(private val api: SetsApi) : SetKatalogRepository {
    override suspend fun getSetExists(setNumber: String) =
        sicherAufrufen { api.getSetExists(setNumber) }.abgebildet { r -> r.setNumber.takeIf { r.exists } }

    override suspend fun getSetDetail(setNumber: String) = sicherAufrufen { api.getSetDetail(setNumber) }.abgebildet { it.set?.alsAnsicht() }

    override suspend fun getSetInfo(setNumber: String) = sicherAufrufen { api.getSetInfo(setNumber) }.abgebildet { it.name }

    override suspend fun getSetPartsList(setNumber: String) = sicherAufrufen { api.getSetPartsList(setNumber) }

    override suspend fun getSetMinifigsList(setNumber: String) = sicherAufrufen { api.getSetMinifigsList(setNumber) }

    override suspend fun resolveBarcode(barcode: String) = sicherAufrufen { api.getBarcodeSet(barcode) }.abgebildet {
        BarcodeAnsicht(it.setNumber, it.name, it.year, it.pieces, it.theme, it.minifigs, it.imageUrl, it.imageLocal, it.unsicher)
    }
}
