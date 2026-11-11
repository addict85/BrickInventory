package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage.Nachzug
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.model.data.model.*
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

    override suspend fun getPartsStats(accounts: String?): Ergebnis<PartsStatsResponse> =
        sicherAufrufen { api.getPartsStats(accounts) }

    /**
     * Die beiden Filterlisten des Teile-Reiters — Farbe und Kategorie. Ohne
     * Zwischenspeicher: Beide tragen Zählwerte, die sich mit jedem erfassten Teil
     * ändern; ein Cache zeigte Zahlen, die nicht zur Liste passen.
     */
    override suspend fun getPartsFilterColors(accounts: String?): Ergebnis<PartsFilterColorsResponse> =
        sicherAufrufen { api.getPartsFilterColors(accounts) }

    override suspend fun getPartsCategories(accounts: String?): Ergebnis<PartsCategoriesResponse> =
        sicherAufrufen { api.getPartsCategories(accounts) }

    /**
     * „Kann ich das bauen?“ — welche Teile einer Liste schon da sind. Ohne
     * Zwischenspeicher wie getSetsMitTeil(): Die Antwort hängt an einer frei
     * zusammengestellten Liste; ein Eintrag je Liste wäre ein Speicher, den niemand
     * ungültig macht, wenn ein Teil dazukommt.
     */
    override suspend fun getOwnedParts(teile: List<BestandTeil>,
                              accounts: String?): Ergebnis<BestandResponse> =
        sicherAufrufen { api.getOwnedParts(BestandRequest(teile), accounts) }

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
    override suspend fun getLagerorte(accounts: String?): Ergebnis<LagerorteResponse> =
        sicherAufrufen { api.getLagerorte(accounts) }

    // ── Der Vorrat an Lagerorten ──
    //
    // Getrennt von getLagerorte(): Dort die belegten Orte (für den Filter), hier die
    // wählbaren (für Auswahlfeld und Einstellungen); ein frisch angelegter Ort steht
    // nur hier. Ohne Zwischenspeicher, weil sich die Liste genau dann ändert, wenn
    // jemand hier etwas einträgt.

    /** @param owner Komma-Liste von Konto-IDs; leer = das eigene Konto. */
    override suspend fun getLagerortVorrat(owner: String?): Ergebnis<LagerortVorratResponse> =
        sicherAufrufen { api.getLagerortVorrat(owner) }

    override suspend fun legeLagerortAn(name: String): Ergebnis<LagerortEintragResponse> =
        sicherAufrufen { api.legeLagerortAn(LagerortNameRequest(name)) }

    override suspend fun benenneLagerortUm(id: Int, alt: String, name: String): Ergebnis<LagerortEintragResponse> =
        ablage.nachgezogen({ r -> r.ort?.takeIf { r.success && alt.isNotBlank() }?.let { Nachzug.LagerortUmbenannt(alt, it.name) } }) {
            sicherAufrufen { api.benenneLagerortUm(id, LagerortNameRequest(name)) }
        }

    override suspend fun loescheLagerort(id: Int): Ergebnis<LagerortResponse> =
        sicherAufrufen { api.loescheLagerort(id) }

    /** Der vorausgewählte Lagerort (Stern) — `null` schaltet die Vorgabe ab. */
    override suspend fun setzeLagerortVorgabe(id: Int?): Ergebnis<LagerortVorgabeResponse> =
        sicherAufrufen { api.setzeLagerortVorgabe(LagerortVorgabeRequest(id)) }

    // ── In welchen Sets steckt dieses Teil / diese Figur? ──
    //
    // Für den Detail-Dialog. Ohne Zwischenspeicher: Die Antwort hängt an genau einem
    // Teil und wird auf Tastendruck geholt — ein Eintrag je Teil-Farb-Paar würde nie
    // ungültig, wenn ein Set dazukommt oder verschwindet.
    override suspend fun getSetsMitTeil(partNumber: String, colorId: Int,
                               accounts: String?): Ergebnis<VerwendendeSetsResponse> =
        sicherAufrufen { api.getSetsMitTeil(partNumber, colorId, accounts) }

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
