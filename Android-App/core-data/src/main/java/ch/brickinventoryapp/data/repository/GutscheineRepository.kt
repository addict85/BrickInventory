package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.model.*

/**
 * Gutscheine samt PDF und Guthabenabfrage.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (GutscheineRepositoryImpl).
 */
interface GutscheineRepository {
    suspend fun liste(): Result<GutscheinListe>

    suspend fun anlegen(request: GutscheinRequest): Result<GutscheinAntwort>

    suspend fun aendern(id: Int, request: GutscheinRequest): Result<GutscheinAntwort>

    suspend fun loeschen(id: Int, bestaetigung: ZweiterFaktorAnfrage): Result<GenericResponse>

    suspend fun klartext(id: Int, bestaetigung: ZweiterFaktorAnfrage): Result<GutscheinKlartext>

    suspend fun pdfFreigabe(id: Int?, bestaetigung: ZweiterFaktorAnfrage): Result<GutscheinPdfFreigabe>

    suspend fun guthaben(id: Int): Result<GuthabenAntwort>

    suspend fun ausPdf(
        dateiname: String,
        typ: String,
        inhalt: ByteArray,
        nummer: String? = null,
        pin: String? = null,
        betrag: String? = null,
        waehrung: String? = null,
    ): Result<GutscheinAntwort>
}
