package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
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
    api: BrickApiService,
    cache: ResponseCache,
) : RepoBasis(api, cache) {

    suspend fun getParts(search: String? = null, color: String? = null,
                         category: String? = null, page: Int = 1,
                         accounts: String? = null,
                         /**
                          * "0" ohne, "1" nur Ersatzteile, null alle — wie parts-spare in der
                          * Webapp.
                          */
                         spare: String? = null,
                         /** "1" nur in der Tabellenansicht — siehe BrickApiService.getParts. */
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
            cached("parts", PartsResponse.serializer()) {
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
        safeCall { api.getManualParts(accounts, search, storage) }

    suspend fun getManualMinifigs(accounts: String? = null,
                                  search: String? = null): Result<ManualFigsResponse> =
        safeCall { api.getManualMinifigs(accounts, search) }

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

    /** Dasselbe fuer eine Minifigur — sie hat keine Farbe (Migration 0024). */
    suspend fun setFigStorage(figNumber: String, ort: String): Result<LagerortResponse> =
        safeCall { api.setFigStorage(figNumber, LagerortRequest(ort)) }

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

    suspend fun getSetsMitFigur(figNumber: String,
                                accounts: String? = null): Result<VerwendendeSetsResponse> =
        safeCall { api.getSetsMitFigur(figNumber, accounts) }

    suspend fun getBrickColors(): Result<BrickColorsResponse> =
        safeCall { api.getBrickColors() }

    suspend fun addPart(partNumber: String, colorId: Int = 0, colorName: String? = null, colorHex: String? = null,
                         quantity: Int = 1, unitPrice: Double? = null,
                         condition: String? = null, ownerUserId: Int? = null,
                         storage: String? = null): Result<AddPartResponse> =
        safeCall { api.addPart(AddPartRequest(partNumber, colorId, colorName, colorHex, quantity,
                                              unitPrice, condition, ownerUserId, storage)) }

    /** @param owner Besitzer der Karte; null = eigenes Konto. */
    suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: String? = null, owner: Int? = null): Result<GenericResponse> =
        safeCall { api.updatePart(partNumber, colorId, UpdateManualItemRequest(quantity, unitPrice, condition = condition), owner) }

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
        safeCall { api.setPartColor(partNumber, colorId,
                                    TeilFarbeRequest(neueFarbe, farbName, farbHex), owner) }

    suspend fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1,
                           unitPrice: Double? = null, condition: String? = null,
                           ownerUserId: Int? = null,
                           storage: String? = null): Result<AddMinifigResponse> =
        safeCall { api.addMinifig(AddMinifigRequest(figNumber, blFigNumber, quantity, unitPrice,
                                                    condition, ownerUserId, storage)) }

    /** @param owner Besitzer der Karte; null = eigenes Konto. */
    suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: String? = null, owner: Int? = null): Result<GenericResponse> =
        safeCall { api.updateMinifig(figNumber, UpdateManualItemRequest(quantity, unitPrice, blFigNumber, condition), owner) }

    /** @param owner Besitzer der Karte; null = eigenes Konto. */
    suspend fun deleteMinifig(figNumber: String, owner: Int? = null): Result<GenericResponse> =
        safeCall { api.deleteMinifig(figNumber, owner) }

    /**
     * Set-Figuren der Übersicht. `source = "set"` und der Suchtext gehen an den Server
     * — wie in der Webapp (public/js/06-minifigs.js, figParams): Der Server sucht vor
     * der Gruppierung über jede fig_name-Zeile; im Composable träfe die Suche nur die
     * eine Zeile, die MAX(fig_name) übrig lässt.
     *
     * Gecacht wird nur die ungefilterte Sicht, wie bei getParts und getSets: Ein
     * Suchergebnis im Cache wäre nach dem Neustart die ganze Sammlung.
     */
    suspend fun getMinifigs(accounts: String? = null, search: String? = null): Result<MinifigsResponse> =
        if (accounts == null && search.isNullOrBlank())
            cached("minifigs", MinifigsResponse.serializer()) {
                safeCall { api.getMinifigs(source = "set") }
            }
        else safeCall { api.getMinifigs(source = "set", accounts = accounts,
                                        search = search?.ifBlank { null }) }

    suspend fun getMinifigStats(accounts: String? = null): Result<ch.brickinventoryapp.data.model.MinifigStatsResponse> =
        safeCall { api.getMinifigStats(accounts) }

    suspend fun getDefaultCondition(): Result<DefaultConditionResponse> = safeCall { api.getDefaultCondition() }

    // Admin-level: saves global default (Monitoring)
    suspend fun setDefaultCondition(condition: String): Result<GenericAdminResponse> = safeCall { api.setDefaultCondition(mapOf("condition" to condition)) }

    // User-level: saves per-user default (empty string = revert to global)
    suspend fun setUserDefaultCondition(condition: String): Result<GenericAdminResponse> = safeCall { api.setUserDefaultCondition(mapOf("condition" to condition)) }
}
