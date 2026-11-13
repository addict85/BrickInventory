package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.data.model.GenericResponse
import ch.brickinventoryapp.model.data.model.GuthabenAntwort
import ch.brickinventoryapp.model.data.model.GutscheinAntwort
import ch.brickinventoryapp.model.data.model.GutscheinKlartext
import ch.brickinventoryapp.model.data.model.GutscheinListe
import ch.brickinventoryapp.model.data.model.GutscheinPdfFreigabe
import ch.brickinventoryapp.model.data.model.GutscheinRequest
import ch.brickinventoryapp.model.data.model.ZweiterFaktorAnfrage
/**
 * Gutscheine samt PDF und Guthabenabfrage.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (GutscheineRepositoryImpl).
 */
interface GutscheineRepository {
    suspend fun liste(): Ergebnis<GutscheinListe>

    suspend fun anlegen(request: GutscheinRequest): Ergebnis<GutscheinAntwort>

    suspend fun aendern(id: Int, request: GutscheinRequest): Ergebnis<GutscheinAntwort>

    suspend fun loeschen(id: Int, bestaetigung: ZweiterFaktorAnfrage): Ergebnis<GenericResponse>

    suspend fun klartext(id: Int, bestaetigung: ZweiterFaktorAnfrage): Ergebnis<GutscheinKlartext>

    suspend fun pdfFreigabe(id: Int?, bestaetigung: ZweiterFaktorAnfrage): Ergebnis<GutscheinPdfFreigabe>

    suspend fun guthaben(id: Int): Ergebnis<GuthabenAntwort>

    suspend fun ausPdf(
        dateiname: String,
        typ: String,
        inhalt: ByteArray,
        nummer: String? = null,
        pin: String? = null,
        betrag: String? = null,
        waehrung: String? = null,
    ): Ergebnis<GutscheinAntwort>
}
