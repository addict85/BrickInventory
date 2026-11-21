package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Confirmation
import ch.brickinventoryapp.model.domain.Guthabenauskunft
import ch.brickinventoryapp.model.domain.Gutscheinangabe
import ch.brickinventoryapp.model.domain.Gutscheinspeicherung
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.domain.PlaintextView

/**
 * Vouchers including PDF and balance query.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (GutscheineRepositoryImpl).
 */
interface VouchersRepository {
    suspend fun liste(): Ergebnis<List<VoucherView>>

    suspend fun anlegen(angabe: Gutscheinangabe): Ergebnis<Gutscheinspeicherung>

    suspend fun aendern(id: Int, angabe: Gutscheinangabe): Ergebnis<Gutscheinspeicherung>

    suspend fun loeschen(id: Int, confirmation: Confirmation): Ergebnis<Unit>

    suspend fun klartext(id: Int, confirmation: Confirmation): Ergebnis<PlaintextView>

    suspend fun pdfRelease(id: Int?, confirmation: Confirmation): Ergebnis<String>

    suspend fun guthaben(id: Int): Ergebnis<Guthabenauskunft>

    suspend fun fromPdf(
        fileName: String,
        typ: String,
        inhalt: ByteArray,
        nummer: String? = null,
        pin: String? = null,
        betrag: String? = null,
        waehrung: String? = null,
    ): Ergebnis<Gutscheinspeicherung>
}
