package ch.brickinventoryapp.data.catalog

import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.repository.mapData
import ch.brickinventoryapp.data.repository.promised
import ch.brickinventoryapp.data.repository.safeCall
import ch.brickinventoryapp.model.domain.BarcodeView
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
internal class SetCatalogRepositoryImpl @Inject constructor(private val api: SetsApi) : SetCatalogRepository {
    override suspend fun getSetExists(setNumber: String) =
        safeCall { api.getSetExists(setNumber) }.mapData { r -> r.setNumber.takeIf { r.exists } }

    override suspend fun getSetDetail(setNumber: String) = safeCall { api.getSetDetail(setNumber) }.mapData { it.set?.asView() }

    override suspend fun getSetInfo(setNumber: String) = safeCall { api.getSetInfo(setNumber) }.mapData { it.name }

    override suspend fun getSetPartsList(setNumber: String) = safeCall { api.getSetPartsList(setNumber) }
        .promised({ it.success }, { it.error }) { r -> r.parts.map { it.asView() } }

    override suspend fun getSetMinifigsList(setNumber: String) = safeCall { api.getSetMinifigsList(setNumber) }
        .promised({ it.success }, { it.error }) { r -> r.figs.map { it.asView() } }

    override suspend fun resolveBarcode(barcode: String) = safeCall { api.getBarcodeSet(barcode) }.mapData {
        BarcodeView(it.setNumber, it.name, it.year, it.pieces, it.theme, it.minifigs, it.imageUrl, it.imageLocal, it.uncertain)
    }
}
