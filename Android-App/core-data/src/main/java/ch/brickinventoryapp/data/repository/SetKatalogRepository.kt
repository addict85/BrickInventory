package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.model.data.model.BarcodeResponse
import ch.brickinventoryapp.model.data.model.MinifigsResponse
import ch.brickinventoryapp.model.data.model.PartsResponse
import ch.brickinventoryapp.model.data.model.SetDetailResponse
import ch.brickinventoryapp.model.data.model.SetExistsResponse
import ch.brickinventoryapp.model.data.model.SetInfoResponse
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Auskünfte zu einem Set beim Erfassen und Nachschlagen: gibt es das schon, was
 * steckt darin, welches Set trägt diesen Barcode. Nichts davon liegt in der
 * Ablage — es sind Fragen an den Server, keine Listen des Kontos.
 */
interface SetKatalogRepository {
    /** Steht das Set schon im Blickfeld? Die Regel (Normalisierung, Haushalt) liegt beim Server. */
    suspend fun getSetExists(setNumber: String): Ergebnis<SetExistsResponse>

    suspend fun getSetDetail(setNumber: String): Ergebnis<SetDetailResponse>

    /** Setname aus dem gemeinsamen Katalog, auch für fremde Sets. */
    suspend fun getSetInfo(setNumber: String): Ergebnis<SetInfoResponse>

    suspend fun getSetPartsList(setNumber: String): Ergebnis<PartsResponse>

    suspend fun getSetMinifigsList(setNumber: String): Ergebnis<MinifigsResponse>

    suspend fun resolveBarcode(barcode: String): Ergebnis<BarcodeResponse>
}

@Singleton
class SetKatalogRepositoryImpl @Inject constructor(private val api: SetsApi) : SetKatalogRepository {
    override suspend fun getSetExists(setNumber: String) = sicherAufrufen { api.getSetExists(setNumber) }

    override suspend fun getSetDetail(setNumber: String) = sicherAufrufen { api.getSetDetail(setNumber) }

    override suspend fun getSetInfo(setNumber: String) = sicherAufrufen { api.getSetInfo(setNumber) }

    override suspend fun getSetPartsList(setNumber: String) = sicherAufrufen { api.getSetPartsList(setNumber) }

    override suspend fun getSetMinifigsList(setNumber: String) = sicherAufrufen { api.getSetMinifigsList(setNumber) }

    override suspend fun resolveBarcode(barcode: String) = sicherAufrufen { api.getBarcodeSet(barcode) }
}
