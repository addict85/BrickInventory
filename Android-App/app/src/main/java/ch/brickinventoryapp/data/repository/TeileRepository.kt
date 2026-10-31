package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Faecher
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Teile, Minifiguren und Farben — eines der Sachgebiete der Datenschicht,
 * erreichbar über `repo.teile.…`; die Begründung der Aufteilung steht in
 * RepoBasis.kt.
 */
@Singleton
class TeileRepository @Inject constructor(
    api: TeileApi,
    cache: ResponseCache,
    ablage: Offlineablage = Offlineablage.fluechtig(),
) : RepoBasis<TeileApi>(api, cache, ablage) {

    suspend fun getParts(search: String? = null, color: String? = null,
                         category: String? = null, page: Int = 1,
                         accounts: String? = null,
                         /**
                          * "0" ohne, "1" nur Ersatzteile, null alle — wie parts-spare in der
                          * Webapp.
                          */
                         spare: String? = null,
                         /** "1" nur in der Tabellenansicht — siehe TeileApi.getParts. */
                         withSets: String? = null,
                         /** Lagerort — eigener Parameter, nicht Teil der Suche. */
                         storage: String? = null): Result<PartsResponse> =
        // Manuell erfasste Teile haben ihren eigenen Bereich — die Set-Teileliste
        // schliesst sie aus (wie in der Webapp). Gecacht wird nur die ungefilterte erste
        // Seite: Sie wird nach einem Neustart gebraucht, ein Suchergebnis im Cache belegte
        // nur Platz. `storage` gehört in die Bedingung, sonst landete eine nach Lagerort
        // gefilterte Antwort unter dem Schlüssel der vollen Liste.
        if (search.isNullOrBlank() && color == null && category == null && page == 1 &&
            accounts == null && spare.isNullOrBlank() && withSets.isNullOrBlank() &&
            storage.isNullOrBlank())
            abgeglichen(Faecher.TEILE, { it.parts }, { PartsResponse(success = true, total = it.size, parts = it) }) {
                safeCall { api.getParts(null, null, null, 1, pageSize = 500, excludeManual = "1") }
            }
        else safeCall { api.getParts(search, color, category, page, pageSize = 500,
                                     excludeManual = "1", accounts = accounts,
                                     spare = spare?.ifBlank { null },
                                     withSets = withSets?.ifBlank { null },
                                     storage = storage?.ifBlank { null }) }

    suspend fun getPartsStats(accounts: String? = null): Result<PartsStatsResponse> =
        safeCall { api.getPartsStats(accounts) }

    /**
     * Die beiden Filterlisten des Teile-Reiters — Farbe und Kategorie. Ohne
     * Zwischenspeicher: Beide tragen Zählwerte, die sich mit jedem erfassten Teil
     * ändern; ein Cache zeigte Zahlen, die nicht zur Liste passen.
     */
    suspend fun getPartsFilterColors(accounts: String? = null): Result<PartsFilterColorsResponse> =
        safeCall { api.getPartsFilterColors(accounts) }

    suspend fun getPartsCategories(accounts: String? = null): Result<PartsCategoriesResponse> =
        safeCall { api.getPartsCategories(accounts) }

    /**
     * Die manuell erfassten Teile bzw. Figuren — dieselbe Quelle wie die Webapp, damit
     * es für dieselbe Liste nur eine Quelle gibt; siehe ManualPartsResponse.
     */
    suspend fun getManualParts(accounts: String? = null, search: String? = null,
                               storage: String? = null): Result<ManualPartsResponse> =
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
    suspend fun getOwnedParts(teile: List<BestandTeil>,
                              accounts: String? = null): Result<BestandResponse> =
        safeCall { api.getOwnedParts(BestandRequest(teile), accounts) }

    /** Lagerort eines Teils setzen. Leerer Text loescht ihn. */
    suspend fun setPartStorage(partNumber: String, colorId: Int, ort: String):
        Result<LagerortResponse> =
        safeCall { api.setPartStorage(partNumber, colorId, LagerortRequest(ort)) }

    /**
     * Welche Lagerorte belegt sind. Ohne Zwischenspeicher: Die Liste ist klein und
     * ändert sich bei jedem Eintragen — ein Speicher liesse den gerade angelegten Ort
     * im Vorschlag fehlen.
     */
    suspend fun getLagerorte(accounts: String? = null): Result<LagerorteResponse> =
        safeCall { api.getLagerorte(accounts) }

    // ── Der Vorrat an Lagerorten ──
    //
    // Getrennt von getLagerorte(): Dort die belegten Orte (für den Filter), hier die
    // wählbaren (für Auswahlfeld und Einstellungen); ein frisch angelegter Ort steht
    // nur hier. Ohne Zwischenspeicher, weil sich die Liste genau dann ändert, wenn
    // jemand hier etwas einträgt.

    /** @param owner Komma-Liste von Konto-IDs; leer = das eigene Konto. */
    suspend fun getLagerortVorrat(owner: String? = null): Result<LagerortVorratResponse> =
        safeCall { api.getLagerortVorrat(owner) }

    suspend fun legeLagerortAn(name: String): Result<LagerortEintragResponse> =
        safeCall { api.legeLagerortAn(LagerortNameRequest(name)) }

    suspend fun benenneLagerortUm(id: Int, name: String): Result<LagerortEintragResponse> =
        safeCall { api.benenneLagerortUm(id, LagerortNameRequest(name)) }

    suspend fun loescheLagerort(id: Int): Result<LagerortResponse> =
        safeCall { api.loescheLagerort(id) }

    /** Der vorausgewählte Lagerort (Stern) — `null` schaltet die Vorgabe ab. */
    suspend fun setzeLagerortVorgabe(id: Int?): Result<LagerortVorgabeResponse> =
        safeCall { api.setzeLagerortVorgabe(LagerortVorgabeRequest(id)) }

    // ── In welchen Sets steckt dieses Teil / diese Figur? ──
    //
    // Für den Detail-Dialog. Ohne Zwischenspeicher: Die Antwort hängt an genau einem
    // Teil und wird auf Tastendruck geholt — ein Eintrag je Teil-Farb-Paar würde nie
    // ungültig, wenn ein Set dazukommt oder verschwindet.
    suspend fun getSetsMitTeil(partNumber: String, colorId: Int,
                               accounts: String? = null): Result<VerwendendeSetsResponse> =
        safeCall { api.getSetsMitTeil(partNumber, colorId, accounts) }

    suspend fun getBrickColors(): Result<BrickColorsResponse> =
        safeCall { api.getBrickColors() }

    /** Ohne Farbe KEINE_FARBE, nie 0 (Schwarz); Name und Code gehören dann nicht dazu. */
    suspend fun addPart(partNumber: String, colorId: Int = KEINE_FARBE, colorName: String? = null, colorHex: String? = null,
                         quantity: Int = 1, unitPrice: Double? = null,
                         condition: String? = null, ownerUserId: Int? = null,
                         storage: String? = null): Result<AddPartResponse> {
        val ohne = colorId == KEINE_FARBE
        val anfrage = AddPartRequest(partNumber, colorId, colorName.takeUnless { ohne },
            colorHex.takeUnless { ohne }, quantity, unitPrice, condition, ownerUserId, storage)
        return schreibe(Bearbeitung.TeilErfassen(anfrage),
            { AddPartResponse(success = true, action = "gepuffert", partNumber = partNumber) }) {
            safeCall { api.addPart(anfrage) }
        }
    }

    /** @param owner Besitzer der Karte; null = eigenes Konto. */
    suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: String? = null, owner: Int? = null): Result<GenericResponse> =
        UpdateManualItemRequest(quantity, unitPrice, condition = condition).let { anfrage ->
            schreibe(Bearbeitung.TeilAendern(partNumber, colorId, anfrage, owner), { GenericResponse(success = true) }) {
                safeCall { api.updatePart(partNumber, colorId, anfrage, owner) }
            }
        }

    /** @param owner Besitzer der Karte; null = eigenes Konto. */
    suspend fun deletePart(partNumber: String, colorId: Int, owner: Int? = null): Result<GenericResponse> =
        safeCall { api.deletePart(partNumber, colorId, owner) }

    /**
     * Die Farbe eines manuell erfassten Teils nachträglich ändern.
     *
     * @param colorId   die alte Farbe — sie sagt, welche Zeile gemeint ist.
     * @param neueFarbe die neue Farbe.
     * @param owner     Besitzer der Karte; null = eigenes Konto.
     */
    suspend fun setPartColor(partNumber: String, colorId: Int, neueFarbe: Int,
                             farbName: String? = null, farbHex: String? = null,
                             owner: Int? = null): Result<TeilFarbeResponse> =
        safeCall { api.setPartColor(partNumber, colorId, TeilFarbeRequest(neueFarbe,
            farbName.takeUnless { neueFarbe == KEINE_FARBE }, farbHex.takeUnless { neueFarbe == KEINE_FARBE }), owner) }
}
