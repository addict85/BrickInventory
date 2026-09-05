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
 * Teile, Minifiguren und Farben.
 *
 * Teil der Aufteilung von BrickRepository (Nachtrag 155) — die Begruendung
 * steht in RepoBasis.kt. Die Ruempfe sind WORTGLEICH uebernommen; veraendert
 * wurde nichts ausser der Klassenzugehoerigkeit.
 *
 * Erreichbar ueber `repo.teile.…` — BrickRepository haelt die fuenf Teile.
 */
@Singleton
class TeileRepository @Inject constructor(
    api: BrickApiService,
    cache: ResponseCache,
) : RepoBasis(api, cache) {

    suspend fun getParts(search: String? = null, color: String? = null,
                         category: String? = null, page: Int = 1,
                         accounts: String? = null,
                         /** "0" ohne, "1" nur Ersatzteile, null alle — wie parts-spare in der Webapp. */
                         spare: String? = null,
                         /** "1" nur in der Tabellenansicht — siehe BrickApiService.getParts. */
                         withSets: String? = null): Result<PartsResponse> =
        // Manuell erfasste Teile haben ihren eigenen Bereich — die Set-Teileliste
        // schließt sie aus (wie in der Webapp).
        // Nur die ungefilterte erste Seite wird gecacht — sie ist das, was nach
        // einem Neustart gebraucht wird. Für Suchergebnisse wäre ein Cache
        // wertlos und würde nur Platz belegen.
        // Auch hier: gecacht wird nur die ungefilterte Sicht (siehe getSets).
        if (search.isNullOrBlank() && color == null && category == null && page == 1 &&
            accounts == null && spare.isNullOrBlank() && withSets.isNullOrBlank())
            cached("parts", PartsResponse.serializer()) {
                safeCall { api.getParts(null, null, null, 1, pageSize = 500, excludeManual = "1") }
            }
        else safeCall { api.getParts(search, color, category, page, pageSize = 500,
                                     excludeManual = "1", accounts = accounts,
                                     spare = spare?.ifBlank { null },
                                     withSets = withSets?.ifBlank { null }) }

    suspend fun getPartsStats(accounts: String? = null): Result<PartsStatsResponse> =
        safeCall { api.getPartsStats(accounts) }

    /**
     * Die beiden Filterlisten des Teile-Reiters — Farbe und Kategorie.
     *
     * Ohne Zwischenspeicher: Beide Listen tragen ZAEHLWERTE und aendern sich
     * mit jedem erfassten Teil. Ein Cache zeigte dem Nutzer Zahlen, die nicht
     * zu der Liste passen, die er gerade vor sich hat.
     */
    suspend fun getPartsFilterColors(accounts: String? = null): Result<PartsFilterColorsResponse> =
        safeCall { api.getPartsFilterColors(accounts) }

    suspend fun getPartsCategories(accounts: String? = null): Result<PartsCategoriesResponse> =
        safeCall { api.getPartsCategories(accounts) }

    /** Rebrickable-Farbnummer → BrickLink-Farbnummer; siehe BlColorMapResponse. */
    suspend fun getBlColorMap(): Result<BlColorMapResponse> = safeCall { api.getBlColorMap() }

    /**
     * Die manuell erfassten Teile bzw. Figuren — dieselbe Quelle wie die
     * Webapp. Vorher kamen sie aus der BEWERTUNG, also aus einer zweiten
     * Quelle fuer dieselbe Liste; siehe ManualPartsResponse.
     */
    suspend fun getManualParts(accounts: String? = null): Result<ManualPartsResponse> =
        safeCall { api.getManualParts(accounts) }

    suspend fun getManualMinifigs(accounts: String? = null): Result<ManualFigsResponse> =
        safeCall { api.getManualMinifigs(accounts) }

    // ── In welchen Sets steckt dieses Teil / diese Figur? ────────────────────
    //
    // Fuer den Detail-Dialog automatisch erfasster Teile und Figuren. BEWUSST
    // ohne Zwischenspeicher (anders als getParts/getMinifigs darueber): Die
    // Antwort haengt an genau einem Teil und wird auf Tastendruck geholt —
    // ein Eintrag je Teil-Farb-Paar waere ein Speicher, den niemand mehr
    // ungueltig macht, wenn ein Set dazukommt oder verschwindet.
    suspend fun getSetsMitTeil(partNumber: String, colorId: Int,
                               accounts: String? = null): Result<VerwendendeSetsResponse> =
        safeCall { api.getSetsMitTeil(partNumber, colorId, accounts) }

    suspend fun getSetsMitFigur(figNumber: String,
                                accounts: String? = null): Result<VerwendendeSetsResponse> =
        safeCall { api.getSetsMitFigur(figNumber, accounts) }

    suspend fun getBrickColors(): Result<BrickColorsResponse> =
        safeCall { api.getBrickColors() }

    suspend fun addPart(partNumber: String, colorId: Int = 0, colorName: String? = null, colorHex: String? = null,
                         quantity: Int = 1, note: String? = null, unitPrice: Double? = null,
                         condition: String? = null, ownerUserId: Int? = null): Result<AddPartResponse> =
        safeCall { api.addPart(AddPartRequest(partNumber, colorId, colorName, colorHex, quantity, note, unitPrice, condition, ownerUserId)) }

    /** @param owner Besitzer der Karte; null = eigenes Konto. */
    suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: String? = null, owner: Int? = null): Result<GenericResponse> =
        safeCall { api.updatePart(partNumber, colorId, UpdateManualItemRequest(quantity, unitPrice, condition = condition), owner) }

    /** @param owner Besitzer der Karte; null = eigenes Konto. */
    suspend fun deletePart(partNumber: String, colorId: Int, owner: Int? = null): Result<GenericResponse> =
        safeCall { api.deletePart(partNumber, colorId, owner) }

    suspend fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1, note: String? = null,
                           unitPrice: Double? = null, condition: String? = null,
                           ownerUserId: Int? = null): Result<AddMinifigResponse> =
        safeCall { api.addMinifig(AddMinifigRequest(figNumber, blFigNumber, quantity, note, unitPrice, condition, ownerUserId)) }

    /** @param owner Besitzer der Karte; null = eigenes Konto. */
    suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: String? = null, owner: Int? = null): Result<GenericResponse> =
        safeCall { api.updateMinifig(figNumber, UpdateManualItemRequest(quantity, unitPrice, blFigNumber, condition), owner) }

    /** @param owner Besitzer der Karte; null = eigenes Konto. */
    suspend fun deleteMinifig(figNumber: String, owner: Int? = null): Result<GenericResponse> =
        safeCall { api.deleteMinifig(figNumber, owner) }

    /**
     * Set-Figuren der Uebersicht. `source = "set"` und der Suchtext gehen an den
     * SERVER — wie in der Webapp (public/js/06-minifigs.js, figParams).
     *
     * Vorher holte die App die GANZE Figurenliste und filterte beides im
     * Composable: `figs.filter { it.source != "manual" }` im Zustand und
     * `contains(search)` in MinifigsScreen. Damit stand dieselbe Regel zweimal
     * im Baum, und die Suche traf nur die zusammengefasste Zeile: Der Server
     * sucht VOR der Gruppierung ueber jede fig_name-Zeile, die App danach nur
     * ueber die eine, die MAX(fig_name) uebrig laesst. Dieselbe Figur, unter
     * zwei Namen aus zwei Sets, fand die Webapp und das Telefon nicht.
     *
     * Gecacht wird nur die ungefilterte Sicht — genau wie bei getParts und
     * getSets. Ein Suchergebnis im Cache waere nach dem Neustart die ganze
     * Sammlung, und der Cache wird nur im Fehlerfall gelesen.
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

    suspend fun getMinifigParts(figNumber: String): Result<PartsResponse> =
        safeCall { api.getMinifigParts(figNumber) }

    suspend fun getDefaultCondition(): Result<DefaultConditionResponse> = safeCall { api.getDefaultCondition() }

    // Admin-level: saves global default (Monitoring)
    suspend fun setDefaultCondition(condition: String): Result<GenericAdminResponse> = safeCall { api.setDefaultCondition(mapOf("condition" to condition)) }

    // User-level: saves per-user default (empty string = revert to global)
    suspend fun setUserDefaultCondition(condition: String): Result<GenericAdminResponse> = safeCall { api.setUserDefaultCondition(mapOf("condition" to condition)) }
}
