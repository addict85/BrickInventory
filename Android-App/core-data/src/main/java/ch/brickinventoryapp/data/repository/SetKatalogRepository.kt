package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.BarcodeView
import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht

import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.TeilAnsicht
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

    /** Die Teile eines Sets aus dem Katalog, je Teil und Farbe eine Zeile. */
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
