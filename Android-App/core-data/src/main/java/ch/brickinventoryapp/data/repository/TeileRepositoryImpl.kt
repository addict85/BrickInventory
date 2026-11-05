package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Faecher
import ch.brickinventoryapp.data.lokal.Lokal
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.data.model.*
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Teile, Minifiguren und Farben — über Retrofit; die gemeinsame Abruflogik steht in RepoBasis.kt.
 */
@Singleton
class TeileRepositoryImpl @Inject constructor(
    api: TeileApi,
    cache: ResponseCache,
    ablage: Offlineablage,
) : RepoBasis<TeileApi>(api, cache, ablage), TeileRepository {

    override suspend fun getParts(search: String?, color: String?,
                         category: String?, page: Int,
                         accounts: String?,
                         /**
                          * "0" ohne, "1" nur Ersatzteile, null alle — wie parts-spare in der
                          * Webapp.
                          */
                         spare: String?,
                         /** "1" nur in der Tabellenansicht — siehe TeileApi.getParts. */
                         withSets: String?,
                         /** Lagerort — eigener Parameter, nicht Teil der Suche. */
                         storage: String?): Ergebnis<PartsResponse> =
        // Manuell erfasste Teile haben ihren eigenen Bereich — die Set-Teileliste
        // schliesst sie aus (wie in der Webapp). Gecacht wird nur die ungefilterte erste
        // Seite: Sie wird nach einem Neustart gebraucht, ein Suchergebnis im Cache belegte
        // nur Platz. `storage` gehört in die Bedingung, sonst landete eine nach Lagerort
        // gefilterte Antwort unter dem Schlüssel der vollen Liste.
        if (page == 1 && listOf(color, category, accounts).all { it == null } &&
            listOf(search, spare, withSets, storage).all { it.isNullOrBlank() })
            abgeglichen(Faecher.TEILE, { it.parts }, { PartsResponse(success = true, total = it.size, parts = it) }) {
                safeCall { api.getParts(null, null, null, 1, pageSize = 500, excludeManual = "1") }
            }
        else safeCall { api.getParts(search, color, category, page, pageSize = 500,
                                     excludeManual = "1", accounts = accounts,
                                     spare = spare?.ifBlank { null },
                                     withSets = withSets?.ifBlank { null },
                                     storage = storage?.ifBlank { null }) }

    /** Die lokalen Listen (ungefiltert); sie ändern sich auch durch offline Bearbeitetes. */
    override fun beobachteTeile(): Flow<Lokal<Part>> = ablage.beobachte(Faecher.TEILE)
    override fun beobachteManuelleTeile(): Flow<Lokal<PartValuationItem>> = ablage.beobachte(Faecher.MANUELLE_TEILE)

    override suspend fun getPartsStats(accounts: String?): Ergebnis<PartsStatsResponse> =
        safeCall { api.getPartsStats(accounts) }

    /**
     * Die beiden Filterlisten des Teile-Reiters — Farbe und Kategorie. Ohne
     * Zwischenspeicher: Beide tragen Zählwerte, die sich mit jedem erfassten Teil
     * ändern; ein Cache zeigte Zahlen, die nicht zur Liste passen.
     */
    override suspend fun getPartsFilterColors(accounts: String?): Ergebnis<PartsFilterColorsResponse> =
        safeCall { api.getPartsFilterColors(accounts) }

    override suspend fun getPartsCategories(accounts: String?): Ergebnis<PartsCategoriesResponse> =
        safeCall { api.getPartsCategories(accounts) }

    /**
     * Die manuell erfassten Teile bzw. Figuren — dieselbe Quelle wie die Webapp, damit
     * es für dieselbe Liste nur eine Quelle gibt; siehe ManualPartsResponse.
     */
    override suspend fun getManualParts(accounts: String?, search: String?,
                               storage: String?): Ergebnis<ManualPartsResponse> =
        if (accounts == null && search.isNullOrBlank() && storage.isNullOrBlank())
            abgeglichen(Faecher.MANUELLE_TEILE, { it.parts }, { ManualPartsResponse(success = true, parts = it) }) {
                safeCall { api.getManualParts(accounts, search, storage) }
            }
        else safeCall { api.getManualParts(accounts, search, storage) }

    /**
     * „Kann ich das bauen?“ — welche Teile einer Liste schon da sind. Ohne
     * Zwischenspeicher wie getSetsMitTeil(): Die Antwort hängt an einer frei
     * zusammengestellten Liste; ein Eintrag je Liste wäre ein Speicher, den niemand
     * ungültig macht, wenn ein Teil dazukommt.
     */
    override suspend fun getOwnedParts(teile: List<BestandTeil>,
                              accounts: String?): Ergebnis<BestandResponse> =
        safeCall { api.getOwnedParts(BestandRequest(teile), accounts) }

    /** Lagerort eines Teils setzen. Leerer Text loescht ihn. */
    override suspend fun setPartStorage(partNumber: String, colorId: Int, ort: String):
        Ergebnis<LagerortResponse> =
        safeCall { api.setPartStorage(partNumber, colorId, LagerortRequest(ort)) }

    /**
     * Welche Lagerorte belegt sind. Ohne Zwischenspeicher: Die Liste ist klein und
     * ändert sich bei jedem Eintragen — ein Speicher liesse den gerade angelegten Ort
     * im Vorschlag fehlen.
     */
    override suspend fun getLagerorte(accounts: String?): Ergebnis<LagerorteResponse> =
        safeCall { api.getLagerorte(accounts) }

    // ── Der Vorrat an Lagerorten ──
    //
    // Getrennt von getLagerorte(): Dort die belegten Orte (für den Filter), hier die
    // wählbaren (für Auswahlfeld und Einstellungen); ein frisch angelegter Ort steht
    // nur hier. Ohne Zwischenspeicher, weil sich die Liste genau dann ändert, wenn
    // jemand hier etwas einträgt.

    /** @param owner Komma-Liste von Konto-IDs; leer = das eigene Konto. */
    override suspend fun getLagerortVorrat(owner: String?): Ergebnis<LagerortVorratResponse> =
        safeCall { api.getLagerortVorrat(owner) }

    override suspend fun legeLagerortAn(name: String): Ergebnis<LagerortEintragResponse> =
        safeCall { api.legeLagerortAn(LagerortNameRequest(name)) }

    override suspend fun benenneLagerortUm(id: Int, name: String): Ergebnis<LagerortEintragResponse> =
        safeCall { api.benenneLagerortUm(id, LagerortNameRequest(name)) }

    override suspend fun loescheLagerort(id: Int): Ergebnis<LagerortResponse> =
        safeCall { api.loescheLagerort(id) }

    /** Der vorausgewählte Lagerort (Stern) — `null` schaltet die Vorgabe ab. */
    override suspend fun setzeLagerortVorgabe(id: Int?): Ergebnis<LagerortVorgabeResponse> =
        safeCall { api.setzeLagerortVorgabe(LagerortVorgabeRequest(id)) }

    // ── In welchen Sets steckt dieses Teil / diese Figur? ──
    //
    // Für den Detail-Dialog. Ohne Zwischenspeicher: Die Antwort hängt an genau einem
    // Teil und wird auf Tastendruck geholt — ein Eintrag je Teil-Farb-Paar würde nie
    // ungültig, wenn ein Set dazukommt oder verschwindet.
    override suspend fun getSetsMitTeil(partNumber: String, colorId: Int,
                               accounts: String?): Ergebnis<VerwendendeSetsResponse> =
        safeCall { api.getSetsMitTeil(partNumber, colorId, accounts) }

    override suspend fun getBrickColors(): Ergebnis<BrickColorsResponse> =
        safeCall { api.getBrickColors() }

    /** Ohne Farbe KEINE_FARBE, nie 0 (Schwarz); Name und Code gehören dann nicht dazu. */
    override suspend fun addPart(partNumber: String, colorId: Int, colorName: String?, colorHex: String?,
                         quantity: Int, unitPrice: Double?,
                         condition: String?, ownerUserId: Int?,
                         storage: String?): Ergebnis<AddPartResponse> {
        val ohne = colorId == KEINE_FARBE
        val anfrage = AddPartRequest(partNumber, colorId, colorName.takeUnless { ohne },
            colorHex.takeUnless { ohne }, quantity, unitPrice, condition, ownerUserId, storage)
        return schreibe(Bearbeitung.TeilErfassen(anfrage),
            { AddPartResponse(success = true, action = "gepuffert", partNumber = partNumber) }) { schluessel ->
            safeCall { api.addPart(anfrage, schluessel) }
        }
    }

    /**
     * Die Menge reist auch als Schritt von der Menge, die die lokale Liste zeigt
     * (UpdateManualItemRequest.quantityDelta).
     *
     * @param owner Besitzer der Karte; null = eigenes Konto.
     */
    override suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: String?, owner: Int?): Ergebnis<GenericResponse> {
        val bisher = ablage.lies(Faecher.MANUELLE_TEILE)?.liste
            ?.firstOrNull { it.partNumber == partNumber && it.colorId == colorId && (owner == null || it.userId == owner) }?.quantity
        val anfrage = UpdateManualItemRequest(quantity, unitPrice, condition = condition, quantityDelta = bisher?.let { quantity - it })
        return schreibe(Bearbeitung.TeilAendern(partNumber, colorId, anfrage, owner), { GenericResponse(success = true) }) { schluessel ->
            safeCall { api.updatePart(partNumber, colorId, anfrage, owner, schluessel) }
        }
    }

    /** Auch offline: Das Teil verschwindet sofort aus der Liste, der Server erfährt es später. */
    override suspend fun deletePart(partNumber: String, colorId: Int, owner: Int?): Ergebnis<GenericResponse> =
        schreibe(Bearbeitung.TeilLoeschen(partNumber, colorId, owner), { GenericResponse(success = true) }) { schluessel ->
            safeCall { api.deletePart(partNumber, colorId, owner, schluessel) }
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
                             owner: Int?): Ergebnis<TeilFarbeResponse> =
        safeCall { api.setPartColor(partNumber, colorId, TeilFarbeRequest(neueFarbe,
            farbName.takeUnless { neueFarbe == KEINE_FARBE }, farbHex.takeUnless { neueFarbe == KEINE_FARBE }), owner) }
}
