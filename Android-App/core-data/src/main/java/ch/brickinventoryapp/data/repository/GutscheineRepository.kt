package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Bestaetigung
import ch.brickinventoryapp.model.fach.Guthabenauskunft
import ch.brickinventoryapp.model.fach.Gutscheinangabe
import ch.brickinventoryapp.model.fach.Gutscheinspeicherung
import ch.brickinventoryapp.model.ui.model.GutscheinAnsicht
import ch.brickinventoryapp.model.ui.model.KlartextAnsicht

/**
 * Gutscheine samt PDF und Guthabenabfrage.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (GutscheineRepositoryImpl).
 */
interface GutscheineRepository {
    suspend fun liste(): Ergebnis<List<GutscheinAnsicht>>

    suspend fun anlegen(angabe: Gutscheinangabe): Ergebnis<Gutscheinspeicherung>

    suspend fun aendern(id: Int, angabe: Gutscheinangabe): Ergebnis<Gutscheinspeicherung>

    suspend fun loeschen(id: Int, bestaetigung: Bestaetigung): Ergebnis<Unit>

    suspend fun klartext(id: Int, bestaetigung: Bestaetigung): Ergebnis<KlartextAnsicht>

    suspend fun pdfFreigabe(id: Int?, bestaetigung: Bestaetigung): Ergebnis<String>

    suspend fun guthaben(id: Int): Ergebnis<Guthabenauskunft>

    suspend fun ausPdf(
        dateiname: String,
        typ: String,
        inhalt: ByteArray,
        nummer: String? = null,
        pin: String? = null,
        betrag: String? = null,
        waehrung: String? = null,
    ): Ergebnis<Gutscheinspeicherung>
}
