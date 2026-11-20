package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Confirmation
import ch.brickinventoryapp.model.fach.Guthabenauskunft
import ch.brickinventoryapp.model.fach.Gutscheinangabe
import ch.brickinventoryapp.model.fach.Gutscheinspeicherung
import ch.brickinventoryapp.model.fach.VoucherView
import ch.brickinventoryapp.model.fach.PlaintextView

/**
 * Gutscheine samt PDF und Guthabenabfrage.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (GutscheineRepositoryImpl).
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
