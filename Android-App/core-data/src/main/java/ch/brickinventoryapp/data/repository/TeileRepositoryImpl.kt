package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Kontoauswahl
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage.Nachzug
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.model.data.model.VorratsOrt
import ch.brickinventoryapp.model.data.model.AddPartRequest
import ch.brickinventoryapp.model.data.model.AddPartResponse
import ch.brickinventoryapp.model.data.model.BestandRequest
import ch.brickinventoryapp.model.data.model.BestandResponse
import ch.brickinventoryapp.model.data.model.BestandTeil
import ch.brickinventoryapp.model.data.model.BrickColorsResponse
import ch.brickinventoryapp.model.data.model.GenericResponse
import ch.brickinventoryapp.model.data.model.KEINE_FARBE
import ch.brickinventoryapp.model.data.model.LagerortEintragResponse
import ch.brickinventoryapp.model.data.model.LagerortNameRequest
import ch.brickinventoryapp.model.data.model.LagerortRequest
import ch.brickinventoryapp.model.data.model.LagerortResponse
import ch.brickinventoryapp.model.data.model.LagerortVorgabeRequest
import ch.brickinventoryapp.model.data.model.LagerortVorgabeResponse
import ch.brickinventoryapp.model.data.model.LagerortVorratResponse
import ch.brickinventoryapp.model.data.model.LagerorteResponse
import ch.brickinventoryapp.model.data.model.Part
import ch.brickinventoryapp.model.data.model.PartValuationItem
import ch.brickinventoryapp.model.data.model.PartsCategoriesResponse
import ch.brickinventoryapp.model.data.model.PartsFilterColorsResponse
import ch.brickinventoryapp.model.data.model.PartsStatsResponse
import ch.brickinventoryapp.model.data.model.TeilFarbeRequest
import ch.brickinventoryapp.model.data.model.TeilFarbeResponse
import ch.brickinventoryapp.model.data.model.UpdateManualItemRequest
import ch.brickinventoryapp.model.data.model.VerwendendeSetsResponse
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.model.data.Ersatzteilwahl

/**
 * Teile, Minifiguren und Farben — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class TeileRepositoryImpl @Inject constructor(
    private val api: TeileApi,
    private val ablage: Offlineablage,
    private val wiederholung: Wiederholung,
) : TeileRepository {

    /** Die lokalen Listen nach den Filtern der Anzeige; sie ändern sich auch durch offline Bearbeitetes. */
    override fun beobachteTeile(suche: String?, farbe: String?, kategorie: String?, ersatzteile: Ersatzteilwahl): Flow<Lokal<Part>> =
        ablage.beobachte(Faecher.TEILE, Filterspalten(suchtext = suche?.ifBlank { null }, farbe = farbe?.ifBlank { null },
            kategorie = kategorie?.ifBlank { null }, ersatzteil = ersatzteile.alsMerkmal()))

    override fun beobachteManuelleTeile(suche: String?): Flow<Lokal<PartValuationItem>> =
        ablage.beobachte(Faecher.MANUELLE_TEILE, Filterspalten(suchtext = suche?.ifBlank { null }))

    override suspend fun aktualisiereTeile(): Ergebnis<Unit> {
        val teile = ablage.aktualisiereSeitenweise(Faecher.TEILE, { it.parts }, { it.total }, wiederholung) { seite ->
            sicherAufrufen { api.getParts(null, null, null, seite, pageSize = 500, excludeManual = "1") }
        }
        if (teile is Ergebnis.Error) return teile
        return aktualisiereManuelleTeile()
    }

    /** Eine Liste ohne Seiten: Die Gesamtzahl ist die Länge der Antwort. */
    override suspend fun aktualisiereManuelleTeile(): Ergebnis<Unit> =
        ablage.aktualisiereSeitenweise(Faecher.MANUELLE_TEILE, { it.parts }, { it.parts.size }, wiederholung) { _ ->
            sicherAufrufen { api.getManualParts(null, null, null) }
        }

    override suspend fun getPartsStats(konten: Kontoauswahl?): Ergebnis<PartsStatsResponse> =
        sicherAufrufen { api.getPartsStats(konten?.anfrage) }

    /**
     * Die beiden Filterlisten des Teile-Reiters — Farbe und Kategorie. Ohne
     * Zwischenspeicher: Beide tragen Zählwerte, die sich mit jedem erfassten Teil
     * ändern; ein Cache zeigte Zahlen, die nicht zur Liste passen.
     */
    override suspend fun getPartsFilterColors(konten: Kontoauswahl?): Ergebnis<PartsFilterColorsResponse> =
        sicherAufrufen { api.getPartsFilterColors(konten?.anfrage) }

    override suspend fun getPartsCategories(konten: Kontoauswahl?): Ergebnis<PartsCategoriesResponse> =
        sicherAufrufen { api.getPartsCategories(konten?.anfrage) }

    /**
     * „Kann ich das bauen?“ — welche Teile einer Liste schon da sind. Ohne
     * Zwischenspeicher wie getSetsMitTeil(): Die Antwort hängt an einer frei
     * zusammengestellten Liste; ein Eintrag je Liste wäre ein Speicher, den niemand
     * ungültig macht, wenn ein Teil dazukommt.
     */
    override suspend fun getOwnedParts(teile: List<BestandTeil>,
                              konten: Kontoauswahl?): Ergebnis<BestandResponse> =
        sicherAufrufen { api.getOwnedParts(BestandRequest(teile), konten?.anfrage) }

    /** Lagerort eines Teils setzen. Leerer Text loescht ihn. */
    override suspend fun setPartStorage(partNumber: String, colorId: Int, ort: String):
        Ergebnis<LagerortResponse> =
        ablage.nachgezogen({ r -> Nachzug.TeilLagerort(partNumber, colorId, r.storage).takeIf { r.success } }) {
            sicherAufrufen { api.setPartStorage(partNumber, colorId, LagerortRequest(ort)) }
        }

    /**
     * Welche Lagerorte belegt sind. Ohne Zwischenspeicher: Die Liste ist klein und
     * ändert sich bei jedem Eintragen — ein Speicher liesse den gerade angelegten Ort
     * im Vorschlag fehlen.
     */
    override suspend fun getLagerorte(konten: Kontoauswahl?): Ergebnis<LagerorteResponse> =
        sicherAufrufen { api.getLagerorte(konten?.anfrage) }

    // ── Der Vorrat an Lagerorten ──
    //
    // Getrennt von getLagerorte(): Dort die belegten Orte (für den Filter), hier die
    // wählbaren (für Auswahlfeld und Einstellungen); ein frisch angelegter Ort steht
    // nur hier. Ohne Zwischenspeicher, weil sich die Liste genau dann ändert, wenn
    // jemand hier etwas einträgt.

    override fun beobachteLagerortVorrat(): Flow<Lokal<VorratsOrt>> = ablage.beobachte(Faecher.LAGERORTE)

    /** Die Vorgabe kommt neben der Liste; in der Ablage trägt sie der Ort selbst. */
    override suspend fun aktualisiereLagerortVorrat(): Ergebnis<Unit> =
        ablage.aktualisiereSeitenweise(Faecher.LAGERORTE, { r -> r.orte.map { VorratsOrt(it, it.id == r.vorgabe?.id) } },
            { it.orte.size }, wiederholung) { _ -> sicherAufrufen { api.getLagerortVorrat(null) } }

    override suspend fun getLagerortVorrat(besitzer: List<Int>): Ergebnis<LagerortVorratResponse> =
        sicherAufrufen { api.getLagerortVorrat(besitzer.takeIf { it.isNotEmpty() }?.joinToString(",")) }

    override suspend fun legeLagerortAn(name: String): Ergebnis<LagerortEintragResponse> =
        ablage.nachgezogen({ r -> r.ort?.takeIf { r.success }?.let { Nachzug.LagerortAngelegt(it) } }) {
            sicherAufrufen { api.legeLagerortAn(LagerortNameRequest(name)) }
        }

    override suspend fun benenneLagerortUm(id: Int, alt: String, name: String): Ergebnis<LagerortEintragResponse> =
        ablage.nachgezogen({ r -> r.ort?.takeIf { r.success }?.let { Nachzug.LagerortUmbenannt(alt, it) } }) {
            sicherAufrufen { api.benenneLagerortUm(id, LagerortNameRequest(name)) }
        }

    override suspend fun loescheLagerort(id: Int): Ergebnis<LagerortResponse> =
        ablage.nachgezogen({ r -> Nachzug.LagerortGeloescht(id).takeIf { r.success } }) { sicherAufrufen { api.loescheLagerort(id) } }

    /** Der vorausgewählte Lagerort (Stern) — `null` schaltet die Vorgabe ab; es gilt, was der Server meldet. */
    override suspend fun setzeLagerortVorgabe(id: Int?): Ergebnis<LagerortVorgabeResponse> =
        ablage.nachgezogen({ r -> Nachzug.LagerortVorgabe(r.vorgabe?.id).takeIf { r.success } }) {
            sicherAufrufen { api.setzeLagerortVorgabe(LagerortVorgabeRequest(id)) }
        }

    // ── In welchen Sets steckt dieses Teil / diese Figur? ──
    //
    // Für den Detail-Dialog. Ohne Zwischenspeicher: Die Antwort hängt an genau einem
    // Teil und wird auf Tastendruck geholt — ein Eintrag je Teil-Farb-Paar würde nie
    // ungültig, wenn ein Set dazukommt oder verschwindet.
    override suspend fun getSetsMitTeil(partNumber: String, colorId: Int,
                               konten: Kontoauswahl?): Ergebnis<VerwendendeSetsResponse> =
        sicherAufrufen { api.getSetsMitTeil(partNumber, colorId, konten?.anfrage) }

    override suspend fun getBrickColors(): Ergebnis<BrickColorsResponse> =
        sicherAufrufen { api.getBrickColors() }

    /** Ohne Farbe KEINE_FARBE, nie 0 (Schwarz); Name und Code gehören dann nicht dazu. */
    override suspend fun addPart(partNumber: String, colorId: Int, colorName: String?, colorHex: String?,
                         quantity: Int, unitPrice: Double?,
                         condition: Zustand?, ownerUserId: Int?,
                         storage: String?): Ergebnis<AddPartResponse> {
        val ohne = colorId == KEINE_FARBE
        val anfrage = AddPartRequest(partNumber, colorId, colorName.takeUnless { ohne },
            colorHex.takeUnless { ohne }, quantity, unitPrice, condition, ownerUserId, storage)
        return ablage.schreibe(Bearbeitung.TeilErfassen(anfrage),
            { AddPartResponse(success = true, action = "gepuffert", partNumber = partNumber) }) { schluessel ->
            sicherAufrufen { api.addPart(anfrage, schluessel) }
        }
    }

    /**
     * Die Menge reist auch als Schritt von der Menge, die die lokale Liste zeigt
     * (UpdateManualItemRequest.quantityDelta).
     *
     * @param owner Besitzer der Karte; null = eigenes Konto.
     */
    override suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: Zustand?, owner: Int?): Ergebnis<GenericResponse> {
        val bisher = ablage.lies(Faecher.MANUELLE_TEILE)?.liste
            ?.firstOrNull { it.partNumber == partNumber && it.colorId == colorId && (owner == null || it.userId == owner) }?.quantity
        val anfrage = UpdateManualItemRequest(quantity, unitPrice, condition = condition, quantityDelta = bisher?.let { quantity - it })
        return ablage.schreibe(Bearbeitung.TeilAendern(partNumber, colorId, anfrage, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.updatePart(partNumber, colorId, anfrage, owner, schluessel) }
        }
    }

    /** Auch offline: Das Teil verschwindet sofort aus der Liste, der Server erfährt es später. */
    override suspend fun deletePart(partNumber: String, colorId: Int, owner: Int?): Ergebnis<GenericResponse> =
        ablage.schreibe(Bearbeitung.TeilLoeschen(partNumber, colorId, owner), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.deletePart(partNumber, colorId, owner, schluessel) }
        }

    /**
     * Die Farbe eines manuell erfassten Teils nachträglich ändern.
     *
     * @param colorId   die alte Farbe — sie sagt, welche Zeile gemeint ist.
     * @param neueFarbe die neue Farbe.
     * @param owner     Besitzer der Karte; null = eigenes Konto.
     */
    override suspend fun setPartColor(partNumber: String, colorId: Int, neueFarbe: Int,
                             farbName: String?, farbHex: String?,
                             owner: Int?): Ergebnis<TeilFarbeResponse> {
        val name = farbName.takeUnless { neueFarbe == KEINE_FARBE }
        val hex = farbHex.takeUnless { neueFarbe == KEINE_FARBE }
        return ablage.nachgezogen({ r -> Nachzug.TeilFarbe(partNumber, colorId, neueFarbe, name, hex, owner).takeIf { r.success } }) {
            sicherAufrufen { api.setPartColor(partNumber, colorId, TeilFarbeRequest(neueFarbe, name, hex), owner) }
        }
    }
}
