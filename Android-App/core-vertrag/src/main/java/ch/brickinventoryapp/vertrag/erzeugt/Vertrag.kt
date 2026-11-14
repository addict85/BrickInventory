// Erzeugt aus Web-App/docs/openapi.json durch Web-App/scripts/vertrag-kotlin-dtos.js.
// Nicht von Hand ändern: npm run vertrag:kotlin (im Ordner Web-App).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName")

package ch.brickinventoryapp.vertrag.erzeugt

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Serializable
data class Acquisition(
    @SerialName("id") val id: Long,
    @SerialName("quantity") val quantity: Long,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("condition") val condition: String,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Long? = null,
    @SerialName("price_estimated") val priceEstimated: Boolean,
    @SerialName("currency") val currency: String? = null,
    @SerialName("preis_konto") val preisKonto: Double? = null,
)

@Serializable
data class AcquisitionTotals(
    @SerialName("quantity") val quantity: Long,
    @SerialName("amount") val amount: Double? = null,
    @SerialName("priced_rows") val pricedRows: Long,
    @SerialName("currency") val currency: String? = null,
    @SerialName("ohne_kurs") val ohneKurs: Long? = null,
)

@Serializable
data class AcquisitionsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("owner_user_id") val ownerUserId: Long? = null,
    @SerialName("acquisitions") val acquisitions: List<Acquisition>,
    @SerialName("totals") val totals: AcquisitionTotals,
    @SerialName("degradiert") val degradiert: List<String>? = null,
)

@Serializable
data class AddMinifigResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String? = null,
    @SerialName("fig_number") val figNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("price_from_condition") val priceFromCondition: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class AddPartResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String? = null,
    @SerialName("part_number") val partNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("price_from_condition") val priceFromCondition: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class AddSetResponse(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("action") val action: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("katalog_offen") val katalogOffen: Boolean? = null,
    @SerialName("ergaenzung") val ergaenzung: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Long? = null,
    @SerialName("is_self") val isSelf: Boolean? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class AndereBeendet(
    @SerialName("success") val success: Boolean,
    @SerialName("deleted") val deleted: Long,
    @SerialName("zugaenge") val zugaenge: Long? = null,
)

@Serializable
data class AnleitungHochgeladen(
    @SerialName("new_quantity") val newQuantity: Long? = null,
    @SerialName("from_user_id") val fromUserId: Long? = null,
    @SerialName("to_user_id") val toUserId: Long? = null,
    @SerialName("merged") val merged: Boolean? = null,
    @SerialName("unchanged") val unchanged: Boolean? = null,
    @SerialName("acquisitions") val acquisitions: Long? = null,
    @SerialName("instructions") val instructions: Long? = null,
    @SerialName("papierkorb") val papierkorb: JsonElement? = null,
    @SerialName("removed") val removed: Long? = null,
    @SerialName("linked_to") val linkedTo: AnleitungHochgeladenLinkedTo? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("set") val set: AnleitungHochgeladenSet? = null,
    @SerialName("parts") val parts: Long? = null,
    @SerialName("minifigs") val minifigs: Long? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean? = null,
    @SerialName("quantity") val quantity: Long? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
    @SerialName("instruction") val instruction: AnleitungHochgeladenInstruction,
)

@Serializable
data class AnleitungHochgeladenLinkedTo(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class AnleitungHochgeladenSet(
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("conditions") val conditions: List<String>? = null,
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
)

@Serializable
data class AnleitungHochgeladenInstruction(
    @SerialName("url") val url: String,
    @SerialName("description") val description: String? = null,
    @SerialName("local_path") val localPath: String,
)

@Serializable
data class AnleitungenGeladen(
    @SerialName("success") val success: Boolean,
    @SerialName("count") val count: Long,
    @SerialName("instructions") val instructions: List<Instruction>,
    @SerialName("auftrag_id") val auftragId: String? = null,
)

@Serializable
data class AnmeldeNutzer(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
    @SerialName("is_admin") val isAdmin: Boolean? = null,
    @SerialName("mustChangePassword") val mustChangePassword: Boolean? = null,
    @SerialName("zweiterFaktorPflicht") val zweiterFaktorPflicht: Boolean? = null,
)

@Serializable
data class ApiLimits(
    @SerialName("rebrickable") val rebrickable: Long,
    @SerialName("bricklink") val bricklink: Long,
    @SerialName("brickset") val brickset: Long,
)

@Serializable
data class ApiLimitsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("limits") val limits: ApiLimits,
)

@Serializable
data class AppThemeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("theme") val theme: String,
    @SerialName("vorgabe") val vorgabe: String? = null,
    @SerialName("eigenes") val eigenes: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class AppToken(
    @SerialName("token_id") val tokenId: String,
    @SerialName("label") val label: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("last_used") val lastUsed: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("never_expires") val neverExpires: Boolean,
    @SerialName("aktuell") val aktuell: Boolean,
    @SerialName("token_prefix") val tokenPrefix: String? = null,
    @SerialName("hard_expires_at") val hardExpiresAt: String? = null,
    @SerialName("scope") val scope: String? = null,
    @SerialName("ip_bereich") val ipBereich: String? = null,
    @SerialName("rotiert_am") val rotiertAm: String? = null,
)

@Serializable
data class AuftraegeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("auftraege") val auftraege: List<Auftrag>,
    @SerialName("zusammenfassung") val zusammenfassung: List<AuftragZaehler>,
    @SerialName("pausen") val pausen: List<AuftragPause>,
    @SerialName("bildbedarf") val bildbedarf: Long,
    @SerialName("job_prozess") val jobProzess: JobProzess,
)

@Serializable
data class Auftrag(
    @SerialName("id") val id: String,
    @SerialName("art") val art: String,
    @SerialName("status") val status: String,
    @SerialName("versuche") val versuche: Long,
    @SerialName("max_versuche") val maxVersuche: Long,
    @SerialName("faellig_ab") val faelligAb: String? = null,
    @SerialName("frist_bis") val fristBis: String? = null,
    @SerialName("gestartet") val gestartet: String? = null,
    @SerialName("erstellt") val erstellt: String? = null,
    @SerialName("aktualisiert") val aktualisiert: String? = null,
    @SerialName("fortschritt") val fortschritt: AuftragFortschritt? = null,
    @SerialName("fehler") val fehler: String? = null,
    @SerialName("geplant") val geplant: Boolean,
    @SerialName("wartet") val wartet: Boolean,
    @SerialName("set_number") val setNumber: String? = null,
)

@Serializable
data class AuftragAenderung(
    @SerialName("success") val success: Boolean,
    @SerialName("id") val id: String,
    @SerialName("status") val status: String,
)

@Serializable
data class AuftragFortschritt(
    @SerialName("erledigt") val erledigt: Long? = null,
    @SerialName("gesamt") val gesamt: Long? = null,
    @SerialName("text") val text: String? = null,
)

@Serializable
data class AuftragPause(
    @SerialName("art") val art: String,
    @SerialName("bis") val bis: String? = null,
    @SerialName("grund") val grund: String? = null,
)

@Serializable
data class AuftragZaehler(
    @SerialName("art") val art: String,
    @SerialName("status") val status: String,
    @SerialName("anzahl") val anzahl: Long,
)

@Serializable
data class AuftragsArtLeerung(
    @SerialName("success") val success: Boolean,
    @SerialName("art") val art: String,
    @SerialName("entfernt") val entfernt: Long,
)

@Serializable
data class AuftragsArtStart(
    @SerialName("success") val success: Boolean,
    @SerialName("art") val art: String,
    @SerialName("gestartet") val gestartet: Boolean,
)

@Serializable
data class BarcodeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Long? = null,
    @SerialName("pieces") val pieces: Long? = null,
    @SerialName("theme") val theme: String? = null,
    @SerialName("minifigs") val minifigs: Long? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("unsicher") val unsicher: Boolean,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class BestandEintrag(
    @SerialName("gesamt") val gesamt: Long? = null,
    @SerialName("lose") val lose: Long? = null,
)

@Serializable
data class BestandGeleert(
    @SerialName("success") val success: Boolean,
    @SerialName("sets") val sets: Long,
    @SerialName("teile") val teile: Long,
    @SerialName("figuren") val figuren: Long,
    @SerialName("papierkorb") val papierkorb: List<Long>,
)

@Serializable
data class BestandResponse(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("bestand") val bestand: JsonObject? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class BildDiagnose(
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("hinweise") val hinweise: List<String>,
    @SerialName("datenbank") val datenbank: BildDiagnoseDatenbank,
    @SerialName("lokal") val lokal: BildDiagnoseLokal,
    @SerialName("proxy") val proxy: BildDiagnoseProxy,
    @SerialName("merker") val merker: BildDiagnoseMerker? = null,
)

@Serializable
data class BildDiagnoseDatenbank(
    @SerialName("anzahl_konten") val anzahlKonten: Long,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("katalog_bild") val katalogBild: String? = null,
)

@Serializable
data class BildDiagnoseLokal(
    @SerialName("original") val original: BildDiagnoseLokalOriginal,
    @SerialName("vorschau") val vorschau: BildDiagnoseLokalVorschau,
)

@Serializable
data class BildDiagnoseLokalOriginal(
    @SerialName("vorhanden") val vorhanden: Boolean,
    @SerialName("bytes") val bytes: Long,
    @SerialName("geaendert") val geaendert: String? = null,
)

@Serializable
data class BildDiagnoseLokalVorschau(
    @SerialName("vorhanden") val vorhanden: Boolean,
    @SerialName("bytes") val bytes: Long,
    @SerialName("geaendert") val geaendert: String? = null,
)

@Serializable
data class BildDiagnoseProxy(
    @SerialName("gecacht") val gecacht: Boolean,
    @SerialName("adresse") val adresse: String? = null,
)

@Serializable
data class BildDiagnoseMerker(
    @SerialName("seit") val seit: String? = null,
    @SerialName("grund") val grund: String? = null,
)

@Serializable
data class BildMerkerVergessen(
    @SerialName("success") val success: Boolean,
    @SerialName("entfernt") val entfernt: Long,
    @SerialName("hinweis") val hinweis: String,
)

@Serializable
data class BlFarbTabelle(
    @SerialName("success") val success: Boolean,
    @SerialName("source") val source: String,
    @SerialName("map") val map: JsonObject,
    @SerialName("degradiert") val degradiert: List<String>? = null,
)

@Serializable
data class BrickColor(
    @SerialName("id") val id: Long,
    @SerialName("name") val name: String,
    @SerialName("hex") val hex: String? = null,
)

@Serializable
data class BrickColorsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("colors") val colors: List<BrickColor>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class BricklinkVerweise(
    @SerialName("success") val success: Boolean,
    @SerialName("links") val links: JsonObject,
)

@Serializable
data class BricksetQueueEntry(
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("attempts") val attempts: Long,
    @SerialName("retry_after") val retryAfter: String? = null,
    @SerialName("last_error") val lastError: String? = null,
)

@Serializable
data class BricksetQueueResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long,
    @SerialName("page") val page: Long,
    @SerialName("page_size") val pageSize: Long,
    @SerialName("count") val count: Long,
    @SerialName("entries") val entries: List<BricksetQueueEntry>,
)

@Serializable
data class CacheStatsResponse(
    @SerialName("db_pool") val dbPool: JsonObject? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("prices") val prices: Long,
    @SerialName("subsets") val subsets: Long,
    @SerialName("catalog") val catalog: Long,
    @SerialName("price_stale") val priceStale: Long,
    @SerialName("rate_limits") val rateLimits: RateLimits? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
)

@Serializable
data class CacheTtlResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("ttl") val ttl: String,
)

@Serializable
data class CatalogMetaResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("themes") val themes: List<CatalogTheme>,
    @SerialName("year_min") val yearMin: Long? = null,
    @SerialName("year_max") val yearMax: Long? = null,
    @SerialName("year_counts") val yearCounts: List<CatalogYearCount>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class CatalogSetDetail(
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Long? = null,
    @SerialName("theme_id") val themeId: Long? = null,
    @SerialName("theme_name") val themeName: String? = null,
    @SerialName("num_parts") val numParts: Long? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("minifigs") val minifigs: Long,
    @SerialName("owned") val owned: Boolean,
    @SerialName("owned_quantity") val ownedQuantity: Long,
    @SerialName("bricklink") val bricklink: CatalogSetDetailBricklink? = null,
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null,
)

@Serializable
data class CatalogSetDetailBricklink(
    @SerialName("type") val type: String,
    @SerialName("number") val number: String,
    @SerialName("url") val url: String? = null,
    @SerialName("exact") val exact: Boolean,
    @SerialName("resolved") val resolved: Boolean,
)

@Serializable
data class CatalogSetDetailResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set") val set: CatalogSetDetail? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class CatalogSetItem(
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Long? = null,
    @SerialName("theme_id") val themeId: Long? = null,
    @SerialName("theme_name") val themeName: String? = null,
    @SerialName("num_parts") val numParts: Long? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("owned") val owned: Boolean,
    @SerialName("owned_quantity") val ownedQuantity: Long,
)

@Serializable
data class CatalogSetsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long,
    @SerialName("page") val page: Long,
    @SerialName("page_size") val pageSize: Long,
    @SerialName("pages") val pages: Long,
    @SerialName("sets") val sets: List<CatalogSetItem>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class CatalogTheme(
    @SerialName("id") val id: Long,
    @SerialName("name") val name: String,
    @SerialName("set_count") val setCount: Long,
)

@Serializable
data class CatalogYearCount(
    @SerialName("year") val year: Long,
    @SerialName("n") val n: Long,
)

@Serializable
data class CatalogYearVerteilungResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("years") val years: List<JahrAnzahl>,
)

@Serializable
data class ChartPoint(
    @SerialName("x_label") val xLabel: String,
    @SerialName("value") val value: Double,
    @SerialName("y_frac") val yFrac: Double,
)

@Serializable
data class ChartYAxis(
    @SerialName("label") val label: String,
    @SerialName("value") val value: Double,
    @SerialName("frac") val frac: Double,
)

@Serializable
data class ConditionValuation(
    @SerialName("market_price") val marketPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
)

@Serializable
data class CsvImportStatus(
    @SerialName("code") val code: String? = null,
    @SerialName("results") val results: List<CsvImportStatusResultsEintrag>? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("status") val status: String? = null,
    @SerialName("total") val total: Long? = null,
    @SerialName("done") val done: Long? = null,
    @SerialName("current") val current: String? = null,
    @SerialName("ok") val ok: Long? = null,
    @SerialName("warn") val warn: Long? = null,
    @SerialName("err") val err: Long? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("beendet_am") val beendetAm: String? = null,
)

@Serializable
data class CsvImportStatusResultsEintrag(
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("zeile") val zeile: Long? = null,
    @SerialName("success") val success: Boolean? = null,
    @SerialName("action") val action: String? = null,
    @SerialName("isWarning") val isWarning: Boolean? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("menge") val menge: Long? = null,
    @SerialName("katalog_offen") val katalogOffen: Boolean? = null,
    @SerialName("part_number") val partNumber: String? = null,
    @SerialName("fig_number") val figNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("vars") val vars: JsonObject? = null,
    @SerialName("waehrung_angepasst") val waehrungAngepasst: Boolean? = null,
    @SerialName("waehrung_datei") val waehrungDatei: String? = null,
    @SerialName("waehrung_konto") val waehrungKonto: String? = null,
)

@Serializable
data class CurrentByCondition(
    @SerialName("N") val n: CurrentPrice? = null,
    @SerialName("U") val u: CurrentPrice? = null,
)

@Serializable
data class CurrentPrice(
    @SerialName("condition") val condition: String,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("fetched_at") val fetchedAt: String? = null,
)

@Serializable
data class DELETEApiV1MinifigsFigNumber(
    @SerialName("new_quantity") val newQuantity: Long? = null,
    @SerialName("from_user_id") val fromUserId: Long? = null,
    @SerialName("to_user_id") val toUserId: Long? = null,
    @SerialName("merged") val merged: Boolean? = null,
    @SerialName("unchanged") val unchanged: Boolean? = null,
    @SerialName("acquisitions") val acquisitions: Long? = null,
    @SerialName("instructions") val instructions: Long? = null,
    @SerialName("papierkorb") val papierkorb: List<Long>,
    @SerialName("removed") val removed: Long? = null,
    @SerialName("linked_to") val linkedTo: DELETEApiV1MinifigsFigNumberLinkedTo? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("set") val set: DELETEApiV1MinifigsFigNumberSet? = null,
    @SerialName("parts") val parts: Long? = null,
    @SerialName("minifigs") val minifigs: Long? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean? = null,
    @SerialName("quantity") val quantity: Long? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
)

@Serializable
data class DELETEApiV1MinifigsFigNumberLinkedTo(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class DELETEApiV1MinifigsFigNumberSet(
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("conditions") val conditions: List<String>? = null,
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
)

@Serializable
data class DELETEApiV1PapierkorbId(
    @SerialName("success") val success: Boolean,
)

@Serializable
data class DashboardStats(
    @SerialName("currency") val currency: String? = null,
    @SerialName("default_condition") val defaultCondition: String? = null,
    @SerialName("user_default_condition") val userDefaultCondition: String? = null,
    @SerialName("total_sets") val totalSets: Long,
    @SerialName("total_quantity") val totalQuantity: Long,
    @SerialName("total_pieces") val totalPieces: Long,
    @SerialName("total_instructions") val totalInstructions: Long,
    @SerialName("total_parts") val totalParts: Long,
    @SerialName("set_parts") val setParts: Long? = null,
    @SerialName("manual_parts") val manualParts: Long? = null,
    @SerialName("total_minifigs") val totalMinifigs: Long,
)

@Serializable
data class DefaultConditionResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("condition") val condition: String,
)

@Serializable
data class DeleteWithQuantityResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("new_quantity") val newQuantity: Long? = null,
)

@Serializable
class Diagnose

@Serializable
data class Einrichtung(
    @SerialName("success") val success: Boolean,
    @SerialName("offen") val offen: Boolean,
    @SerialName("passwort_aendern") val passwortAendern: Boolean,
    @SerialName("quellen") val quellen: EinrichtungQuellen,
)

@Serializable
data class EinrichtungQuellen(
    @SerialName("rebrickable") val rebrickable: Boolean,
    @SerialName("bricklink") val bricklink: Boolean,
    @SerialName("brickset") val brickset: Boolean,
)

@Serializable
data class EinrichtungStand(
    @SerialName("success") val success: Boolean,
    @SerialName("erledigt") val erledigt: Boolean,
    @SerialName("konfiguriert") val konfiguriert: Boolean,
    @SerialName("schritte") val schritte: List<EinrichtungStandSchritteEintrag>,
    @SerialName("ca") val ca: EinrichtungStandCa,
    @SerialName("basis_url") val basisUrl: String? = null,
    @SerialName("https") val https: Boolean,
    @SerialName("degradiert") val degradiert: List<String>? = null,
)

@Serializable
data class EinrichtungStandSchritteEintrag(
    @SerialName("id") val id: String,
    @SerialName("ok") val ok: Boolean,
    @SerialName("pflicht") val pflicht: Boolean,
)

@Serializable
data class EinrichtungStandCa(
    @SerialName("vorhanden") val vorhanden: Boolean,
    @SerialName("fp_hex") val fpHex: String? = null,
    @SerialName("zert_sha256") val zertSha256: String? = null,
    @SerialName("gueltig_bis") val gueltigBis: String? = null,
    @SerialName("download") val download: String,
)

@Serializable
data class EinstellungenGespeichert(
    @SerialName("new_quantity") val newQuantity: Long? = null,
    @SerialName("from_user_id") val fromUserId: Long? = null,
    @SerialName("to_user_id") val toUserId: Long? = null,
    @SerialName("merged") val merged: Boolean? = null,
    @SerialName("unchanged") val unchanged: Boolean? = null,
    @SerialName("acquisitions") val acquisitions: Long? = null,
    @SerialName("instructions") val instructions: Long? = null,
    @SerialName("papierkorb") val papierkorb: JsonElement? = null,
    @SerialName("removed") val removed: Long? = null,
    @SerialName("linked_to") val linkedTo: EinstellungenGespeichertLinkedTo? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("set") val set: EinstellungenGespeichertSet? = null,
    @SerialName("parts") val parts: Long? = null,
    @SerialName("minifigs") val minifigs: Long? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean? = null,
    @SerialName("quantity") val quantity: Long? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
    @SerialName("updated") val updated: Long,
)

@Serializable
data class EinstellungenGespeichertLinkedTo(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class EinstellungenGespeichertSet(
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("conditions") val conditions: List<String>? = null,
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
)

@Serializable
data class Endpunkte(
    @SerialName("auth") val auth: JsonObject? = null,
    @SerialName("api") val api: String,
    @SerialName("version") val version: String,
    @SerialName("endpoints") val endpoints: JsonObject,
)

@Serializable
data class Fehler(
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String,
    @SerialName("code") val code: String,
)

@Serializable
enum class Fehlercode {
    @SerialName("nicht_angemeldet") NICHT_ANGEMELDET,
    @SerialName("auth_fehler") AUTH_FEHLER,
    @SerialName("nur_admins") NUR_ADMINS,
    @SerialName("tausch_laeuft") TAUSCH_LAEUFT,
    @SerialName("token_ungueltig") TOKEN_UNGUELTIG,
    @SerialName("token_id_fehlt") TOKEN_ID_FEHLT,
    @SerialName("token_rotation_noetig") TOKEN_ROTATION_NOETIG,
    @SerialName("passkey_ungueltig") PASSKEY_UNGUELTIG,
    @SerialName("passkey_ohne_domain") PASSKEY_OHNE_DOMAIN,
    @SerialName("unbegrenzt_nur_https") UNBEGRENZT_NUR_HTTPS,
    @SerialName("token_nicht_ausgestellt") TOKEN_NICHT_AUSGESTELLT,
    @SerialName("konto_deaktiviert") KONTO_DEAKTIVIERT,
    @SerialName("email_nicht_bestaetigt") EMAIL_NICHT_BESTAETIGT,
    @SerialName("zu_viele_anfragen") ZU_VIELE_ANFRAGEN,
    @SerialName("zu_viele_fehlversuche") ZU_VIELE_FEHLVERSUCHE,
    @SerialName("anmeldedaten_ungueltig") ANMELDEDATEN_UNGUELTIG,
    @SerialName("name_oder_email_eingeben") NAME_ODER_EMAIL_EINGEBEN,
    @SerialName("registrierung_deaktiviert") REGISTRIERUNG_DEAKTIVIERT,
    @SerialName("registrierung_braucht_mail") REGISTRIERUNG_BRAUCHT_MAIL,
    @SerialName("konto_nicht_wartend") KONTO_NICHT_WARTEND,
    @SerialName("registrierung_felder") REGISTRIERUNG_FELDER,
    @SerialName("benutzername_passwort") BENUTZERNAME_PASSWORT,
    @SerialName("benutzername_vergeben") BENUTZERNAME_VERGEBEN,
    @SerialName("benutzername_oder_email_vergeben") BENUTZERNAME_ODER_EMAIL_VERGEBEN,
    @SerialName("email_vergeben") EMAIL_VERGEBEN,
    @SerialName("benutzername_ungueltig") BENUTZERNAME_UNGUELTIG,
    @SerialName("email_ungueltig") EMAIL_UNGUELTIG,
    @SerialName("name_ungueltig") NAME_UNGUELTIG,
    @SerialName("geraetename_ungueltig") GERAETENAME_UNGUELTIG,
    @SerialName("email_erforderlich") EMAIL_ERFORDERLICH,
    @SerialName("passwort_zu_kurz") PASSWORT_ZU_KURZ,
    @SerialName("passwort_zu_lang") PASSWORT_ZU_LANG,
    @SerialName("passwort_zu_haeufig") PASSWORT_ZU_HAEUFIG,
    @SerialName("aktuelles_passwort_erforderlich") AKTUELLES_PASSWORT_ERFORDERLICH,
    @SerialName("passwort_ueber_change_password") PASSWORT_UEBER_CHANGE_PASSWORD,
    @SerialName("fremde_herkunft") FREMDE_HERKUNFT,
    @SerialName("fremder_host") FREMDER_HOST,
    @SerialName("bestaetigungslink_ungueltig") BESTAETIGUNGSLINK_UNGUELTIG,
    @SerialName("app_zu_alt") APP_ZU_ALT,
    @SerialName("nur_mit_sitzung") NUR_MIT_SITZUNG,
    @SerialName("nur_mit_app_token") NUR_MIT_APP_TOKEN,
    @SerialName("geraeteschluessel_fehlt") GERAETESCHLUESSEL_FEHLT,
    @SerialName("geraeteschluessel_ungueltig") GERAETESCHLUESSEL_UNGUELTIG,
    @SerialName("geraeteschluessel_vorhanden") GERAETESCHLUESSEL_VORHANDEN,
    @SerialName("geraeteschluessel_frist") GERAETESCHLUESSEL_FRIST,
    @SerialName("geraeteschluessel_attestation") GERAETESCHLUESSEL_ATTESTATION,
    @SerialName("schritt_freigabe_noetig") SCHRITT_FREIGABE_NOETIG,
    @SerialName("schritt_signatur_ungueltig") SCHRITT_SIGNATUR_UNGUELTIG,
    @SerialName("import_unterbrochen") IMPORT_UNTERBROCHEN,
    @SerialName("import_zeile_unterbrochen") IMPORT_ZEILE_UNTERBROCHEN,
    @SerialName("aktuelles_passwort_falsch") AKTUELLES_PASSWORT_FALSCH,
    @SerialName("passwort_wechsel_noetig") PASSWORT_WECHSEL_NOETIG,
    @SerialName("letzter_verwalter") LETZTER_VERWALTER,
    @SerialName("verwalter_muss_bleiben") VERWALTER_MUSS_BLEIBEN,
    @SerialName("zweiter_faktor_pflicht") ZWEITER_FAKTOR_PFLICHT,
    @SerialName("alle_felder_erforderlich") ALLE_FELDER_ERFORDERLICH,
    @SerialName("passwort_reset_nicht_eingerichtet") PASSWORT_RESET_NICHT_EINGERICHTET,
    @SerialName("token_passwort_erforderlich") TOKEN_PASSWORT_ERFORDERLICH,
    @SerialName("eigenes_konto_passwort") EIGENES_KONTO_PASSWORT,
    @SerialName("eigene_adminrolle") EIGENE_ADMINROLLE,
    @SerialName("benutzer_nicht_gefunden") BENUTZER_NICHT_GEFUNDEN,
    @SerialName("eigenes_konto_deaktivieren") EIGENES_KONTO_DEAKTIVIEREN,
    @SerialName("bestaetigung_nicht_eingerichtet") BESTAETIGUNG_NICHT_EINGERICHTET,
    @SerialName("bestaetigung_gesendet") BESTAETIGUNG_GESENDET,
    @SerialName("eigener_zweiter_faktor") EIGENER_ZWEITER_FAKTOR,
    @SerialName("benutzer_nicht_gefunden_oder_eigenes") BENUTZER_NICHT_GEFUNDEN_ODER_EIGENES,
    @SerialName("kein_schreibrecht") KEIN_SCHREIBRECHT,
    @SerialName("kein_zugriff_konto") KEIN_ZUGRIFF_KONTO,
    @SerialName("einladungscode_ungueltig") EINLADUNGSCODE_UNGUELTIG,
    @SerialName("einladungen_zu_viele") EINLADUNGEN_ZU_VIELE,
    @SerialName("einladungscode_abgelaufen") EINLADUNGSCODE_ABGELAUFEN,
    @SerialName("konto_mit_sich_selbst") KONTO_MIT_SICH_SELBST,
    @SerialName("konto_bereits_verknuepft") KONTO_BEREITS_VERKNUEPFT,
    @SerialName("verknuepfung_erzeugt_kreis") VERKNUEPFUNG_ERZEUGT_KREIS,
    @SerialName("konto_id_ungueltig") KONTO_ID_UNGUELTIG,
    @SerialName("waehrung_ungleich") WAEHRUNG_UNGLEICH,
    @SerialName("lagerort_zu_lang") LAGERORT_ZU_LANG,
    @SerialName("lagerort_leer") LAGERORT_LEER,
    @SerialName("lagerort_doppelt") LAGERORT_DOPPELT,
    @SerialName("lagerort_unbekannt") LAGERORT_UNBEKANNT,
    @SerialName("lagerort_in_benutzung") LAGERORT_IN_BENUTZUNG,
    @SerialName("alarm_richtung_ungueltig") ALARM_RICHTUNG_UNGUELTIG,
    @SerialName("alarm_schwelle_ungueltig") ALARM_SCHWELLE_UNGUELTIG,
    @SerialName("alarm_zustand_ungueltig") ALARM_ZUSTAND_UNGUELTIG,
    @SerialName("quelle_ziel_identisch") QUELLE_ZIEL_IDENTISCH,
    @SerialName("kaufpreise_angeben") KAUFPREISE_ANGEBEN,
    @SerialName("set_nicht_gefunden") SET_NICHT_GEFUNDEN,
    @SerialName("setnummer_ungueltig") SETNUMMER_UNGUELTIG,
    @SerialName("set_nicht_im_katalog") SET_NICHT_IM_KATALOG,
    @SerialName("katalog_nicht_geladen") KATALOG_NICHT_GELADEN,
    @SerialName("set_number_erforderlich") SET_NUMBER_ERFORDERLICH,
    @SerialName("parameter_set_fehlt") PARAMETER_SET_FEHLT,
    @SerialName("barcode_kein_set") BARCODE_KEIN_SET,
    @SerialName("teil_nicht_manuell") TEIL_NICHT_MANUELL,
    @SerialName("farbe_erforderlich") FARBE_ERFORDERLICH,
    @SerialName("minifig_nicht_manuell") MINIFIG_NICHT_MANUELL,
    @SerialName("keine_teile") KEINE_TEILE,
    @SerialName("zustand_n_oder_u") ZUSTAND_N_ODER_U,
    @SerialName("erfassung_felder") ERFASSUNG_FELDER,
    @SerialName("kein_bricklink_preis") KEIN_BRICKLINK_PREIS,
    @SerialName("kein_bricklink_zugang") KEIN_BRICKLINK_ZUGANG,
    @SerialName("bricklink_tageslimit") BRICKLINK_TAGESLIMIT,
    @SerialName("bricklink_zugang_fehlt") BRICKLINK_ZUGANG_FEHLT,
    @SerialName("keine_datei") KEINE_DATEI,
    @SerialName("datei_zu_gross") DATEI_ZU_GROSS,
    @SerialName("datei_typ_falsch") DATEI_TYP_FALSCH,
    @SerialName("upload_ungueltig") UPLOAD_UNGUELTIG,
    @SerialName("datei_inhalt_falsch") DATEI_INHALT_FALSCH,
    @SerialName("upload_kontingent_voll") UPLOAD_KONTINGENT_VOLL,
    @SerialName("upload_gesamt_voll") UPLOAD_GESAMT_VOLL,
    @SerialName("datei_nicht_verfuegbar") DATEI_NICHT_VERFUEGBAR,
    @SerialName("json_ungueltig") JSON_UNGUELTIG,
    @SerialName("anfrage_json_ungueltig") ANFRAGE_JSON_UNGUELTIG,
    @SerialName("anfrage_zu_gross") ANFRAGE_ZU_GROSS,
    @SerialName("anfrage_unlesbar") ANFRAGE_UNLESBAR,
    @SerialName("anfrage_ungueltig") ANFRAGE_UNGUELTIG,
    @SerialName("anfrage_zu_langsam") ANFRAGE_ZU_LANGSAM,
    @SerialName("interner_fehler") INTERNER_FEHLER,
    @SerialName("csv_parse_fehler") CSV_PARSE_FEHLER,
    @SerialName("csv_keine_datenzeilen") CSV_KEINE_DATENZEILEN,
    @SerialName("csv_keine_brauchbare_zeile") CSV_KEINE_BRAUCHBARE_ZEILE,
    @SerialName("csv_uebersprungen") CSV_UEBERSPRUNGEN,
    @SerialName("csv_menge_ungueltig") CSV_MENGE_UNGUELTIG,
    @SerialName("csv_keine_setnummer") CSV_KEINE_SETNUMMER,
    @SerialName("import_zeitueberschreitung") IMPORT_ZEITUEBERSCHREITUNG,
    @SerialName("import_kontingent") IMPORT_KONTINGENT,
    @SerialName("feld_erforderlich") FELD_ERFORDERLICH,
    @SerialName("feld_nummer_ungueltig") FELD_NUMMER_UNGUELTIG,
    @SerialName("bild_url_zu_lang") BILD_URL_ZU_LANG,
    @SerialName("bild_url_ungueltig") BILD_URL_UNGUELTIG,
    @SerialName("bild_url_nicht_https") BILD_URL_NICHT_HTTPS,
    @SerialName("feld_negativ") FELD_NEGATIV,
    @SerialName("feld_zu_hoch") FELD_ZU_HOCH,
    @SerialName("feld_kein_wahrheitswert") FELD_KEIN_WAHRHEITSWERT,
    @SerialName("kein_import_laeuft") KEIN_IMPORT_LAEUFT,
    @SerialName("pdf_nicht_fertig") PDF_NICHT_FERTIG,
    @SerialName("pdf_nicht_verfuegbar") PDF_NICHT_VERFUEGBAR,
    @SerialName("pdf_auftrag_laeuft") PDF_AUFTRAG_LAEUFT,
    @SerialName("job_id_ungueltig") JOB_ID_UNGUELTIG,
    @SerialName("job_nicht_gefunden") JOB_NICHT_GEFUNDEN,
    @SerialName("zugang_beendet") ZUGANG_BEENDET,
    @SerialName("unbekannter_job") UNBEKANNTER_JOB,
    @SerialName("auftrag_nicht_aenderbar") AUFTRAG_NICHT_AENDERBAR,
    @SerialName("nummer_ungueltig") NUMMER_UNGUELTIG,
    @SerialName("pin_ungueltig") PIN_UNGUELTIG,
    @SerialName("betrag_ungueltig") BETRAG_UNGUELTIG,
    @SerialName("waehrung_ungueltig") WAEHRUNG_UNGUELTIG,
    @SerialName("waehrung_geteiltes_unterkonto") WAEHRUNG_GETEILTES_UNTERKONTO,
    @SerialName("waehrung_nur_hauptkonto") WAEHRUNG_NUR_HAUPTKONTO,
    @SerialName("gutschein_existiert") GUTSCHEIN_EXISTIERT,
    @SerialName("nur_pdf") NUR_PDF,
    @SerialName("pdf_zu_viele_seiten") PDF_ZU_VIELE_SEITEN,
    @SerialName("upload_laeuft") UPLOAD_LAEUFT,
    @SerialName("quelle_unbekannt") QUELLE_UNBEKANNT,
    @SerialName("quelle_test_fehlgeschlagen") QUELLE_TEST_FEHLGESCHLAGEN,
    @SerialName("quelle_ohne_schluessel") QUELLE_OHNE_SCHLUESSEL,
    @SerialName("quelle_nicht_erreichbar") QUELLE_NICHT_ERREICHBAR,
    @SerialName("quelle_abgelehnt") QUELLE_ABGELEHNT,
    @SerialName("zweiter_faktor_noetig") ZWEITER_FAKTOR_NOETIG,
    @SerialName("zweiter_faktor_falsch") ZWEITER_FAKTOR_FALSCH,
    @SerialName("zweiter_faktor_gesperrt") ZWEITER_FAKTOR_GESPERRT,
    @SerialName("zweiter_faktor_schon_aktiv") ZWEITER_FAKTOR_SCHON_AKTIV,
    @SerialName("zweiter_faktor_nicht_aktiv") ZWEITER_FAKTOR_NICHT_AKTIV,
    @SerialName("papierkorb_schon_vorhanden") PAPIERKORB_SCHON_VORHANDEN,
    @SerialName("keine_gutscheine") KEINE_GUTSCHEINE,
    @SerialName("pdf_freigabe_noetig") PDF_FREIGABE_NOETIG,
    @SerialName("pdf_unlesbar") PDF_UNLESBAR,
    @SerialName("kein_gutschein_im_pdf") KEIN_GUTSCHEIN_IM_PDF,
    @SerialName("guthaben_pin_fehlt") GUTHABEN_PIN_FEHLT,
    @SerialName("guthaben_abstand") GUTHABEN_ABSTAND,
    @SerialName("guthaben_botschutz") GUTHABEN_BOTSCHUTZ,
    @SerialName("guthaben_fehlgeschlagen") GUTHABEN_FEHLGESCHLAGEN,
    @SerialName("guthaben_land_ungueltig") GUTHABEN_LAND_UNGUELTIG,
    @SerialName("korrekturen_ungueltig") KORREKTUREN_UNGUELTIG,
    @SerialName("keine_wanted_liste") KEINE_WANTED_LISTE,
    @SerialName("id_ungueltig") ID_UNGUELTIG,
    @SerialName("eingabe_ungueltig") EINGABE_UNGUELTIG,
    @SerialName("feld_unbekannt") FELD_UNBEKANNT,
    @SerialName("nicht_gefunden") NICHT_GEFUNDEN,
    @SerialName("kaufpreis_nicht_gefunden") KAUFPREIS_NICHT_GEFUNDEN,
    @SerialName("datum_ungueltig") DATUM_UNGUELTIG,
    @SerialName("erfassung_nicht_gefunden") ERFASSUNG_NICHT_GEFUNDEN,
    @SerialName("datum_belegt") DATUM_BELEGT,
    @SerialName("server_ausgelastet") SERVER_AUSGELASTET,
    @SerialName("datenbank_nicht_erreichbar") DATENBANK_NICHT_ERREICHBAR,
    @SerialName("import_abgebrochen") IMPORT_ABGEBROCHEN,
    @SerialName("import_fehlgeschlagen") IMPORT_FEHLGESCHLAGEN,
    @SerialName("import_laeuft_noch") IMPORT_LAEUFT_NOCH,
    @SerialName("idempotenz_schluessel_ungueltig") IDEMPOTENZ_SCHLUESSEL_UNGUELTIG,
    @SerialName("idempotenz_schluessel_anders") IDEMPOTENZ_SCHLUESSEL_ANDERS,
    @SerialName("idempotenz_laeuft") IDEMPOTENZ_LAEUFT,
    @SerialName("idempotenz_nicht_wiederholbar") IDEMPOTENZ_NICHT_WIEDERHOLBAR,
    @SerialName("zu_viele_verbindungen") ZU_VIELE_VERBINDUNGEN,
    @SerialName("zeitlimit") ZEITLIMIT,
    @SerialName("wert_ungueltig") WERT_UNGUELTIG,
    @SerialName("schon_vorhanden") SCHON_VORHANDEN,
    @SerialName("bezug_fehlt") BEZUG_FEHLT,
    @SerialName("uhrzeit_ungueltig") UHRZEIT_UNGUELTIG,
    @SerialName("design_ungueltig") DESIGN_UNGUELTIG,
    @SerialName("tageslimit_bereich") TAGESLIMIT_BEREICH,
    @SerialName("unbekannte_aufgabe") UNBEKANNTE_AUFGABE,
    @SerialName("smtp_nicht_konfiguriert") SMTP_NICHT_KONFIGURIERT,
    @SerialName("smtp_zertifikat") SMTP_ZERTIFIKAT,
    @SerialName("smtp_fehler") SMTP_FEHLER,
    @SerialName("keine_ziel_email") KEINE_ZIEL_EMAIL,
    @SerialName("url_ungueltig") URL_UNGUELTIG,
    @SerialName("url_fehlt_https") URL_FEHLT_HTTPS,
    @SerialName("host_nicht_erlaubt") HOST_NICHT_ERLAUBT,
    @SerialName("qr_ohne_basis_url") QR_OHNE_BASIS_URL,
    @SerialName("qr_abgelehnt") QR_ABGELEHNT,
    @SerialName("qr_code_falsch") QR_CODE_FALSCH,
    @SerialName("qr_nicht_wartend") QR_NICHT_WARTEND,
}

@Serializable
data class FigsValuationResponse(
    @SerialName("kaufpreise_umgerechnet") val kaufpreiseUmgerechnet: Long? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long,
    @SerialName("page") val page: Long,
    @SerialName("page_size") val pageSize: Long,
    @SerialName("currency") val currency: String,
    @SerialName("figs") val figs: List<FigsValuationResponseFigsEintrag>,
    @SerialName("total_value") val totalValue: String,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("preise_ausstehend") val preiseAusstehend: Long? = null,
    @SerialName("kaufpreise_fremde_waehrung") val kaufpreiseFremdeWaehrung: Long,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class FigsValuationResponseFigsEintrag(
    @SerialName("ausstehend") val ausstehend: Boolean? = null,
    @SerialName("from_cache") val fromCache: Boolean? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("storage_id") val storageId: Long? = null,
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("id") val id: Long? = null,
    @SerialName("fig_number") val figNumber: String,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("quantity") val quantity: Long,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("display_value") val displayValue: String? = null,
    @SerialName("total_value") val totalValue: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("conditions") val conditions: List<String>,
    @SerialName("user_id") val userId: Long? = null,
    @SerialName("owners") val owners: List<FigsValuationResponseFigsEintragOwnersEintrag>? = null,
    @SerialName("acquisitions") val acquisitions: List<FigsValuationResponseFigsEintragAcquisitionsEintrag>,
    @SerialName("storage") val storage: String? = null,
)

@Serializable
data class FigsValuationResponseFigsEintragOwnersEintrag(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class FigsValuationResponseFigsEintragAcquisitionsEintrag(
    @SerialName("id") val id: Long,
    @SerialName("condition") val condition: String,
    @SerialName("quantity") val quantity: Long,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Long? = null,
    @SerialName("kaufpreis_original") val kaufpreisOriginal: Double? = null,
    @SerialName("kaufpreis_waehrung") val kaufpreisWaehrung: String? = null,
    @SerialName("price_estimated") val priceEstimated: Boolean? = null,
)

@Serializable
data class FigurTeile(
    @SerialName("success") val success: Boolean,
    @SerialName("source") val source: String,
    @SerialName("parts") val parts: List<JsonObject>,
)

@Serializable
data class ForgotPasswordResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("message") val message: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class GETApiV1Minifigs(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("figs") val figs: List<GETApiV1MinifigsFigsEintrag>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class GETApiV1MinifigsFigsEintrag(
    @SerialName("id") val id: Long? = null,
    @SerialName("in_sets") val inSets: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Long>? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("fig_number") val figNumber: String,
    @SerialName("condition") val condition: String? = null,
    @SerialName("conditions") val conditions: List<String>,
    @SerialName("owners") val owners: List<GETApiV1MinifigsFigsEintragOwnersEintrag>? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("quantity") val quantity: Long,
    @SerialName("total_quantity") val totalQuantity: Long? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("source") val source: String,
    @SerialName("set_added_at") val setAddedAt: String? = null,
)

@Serializable
data class GETApiV1MinifigsFigsEintragOwnersEintrag(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class GETApiV1MinifigsFigNumberSets(
    @SerialName("success") val success: Boolean,
    @SerialName("item") val item: GETApiV1MinifigsFigNumberSetsItem? = null,
    @SerialName("sets") val sets: List<GETApiV1MinifigsFigNumberSetsSetsEintrag>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class GETApiV1MinifigsFigNumberSetsItem(
    @SerialName("nummer") val nummer: String,
    @SerialName("name") val name: String? = null,
    @SerialName("color_id") val colorId: Long? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("is_spare") val isSpare: Boolean,
    @SerialName("storage") val storage: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Long>,
    @SerialName("total_quantity") val totalQuantity: Long,
)

@Serializable
data class GETApiV1MinifigsFigNumberSetsSetsEintrag(
    @SerialName("set_number") val setNumber: String,
    @SerialName("set_name") val setName: String? = null,
    @SerialName("quantity") val quantity: Long,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Long,
)

@Serializable
data class GETApiV1SetsSetNumberPartsList(
    @SerialName("source") val source: String? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long,
    @SerialName("page") val page: Long,
    @SerialName("page_size") val pageSize: Long,
    @SerialName("parts") val parts: List<GETApiV1SetsSetNumberPartsListPartsEintrag>,
    @SerialName("error") val error: String? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
)

@Serializable
data class GETApiV1SetsSetNumberPartsListPartsEintrag(
    @SerialName("condition") val condition: String? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Long,
    @SerialName("bl_color_id") val blColorId: Long? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("total_quantity") val totalQuantity: Long,
    @SerialName("in_sets") val inSets: String? = null,
    @SerialName("is_spare") val isSpare: Boolean,
)

@Serializable
data class GelesenerGutschein(
    @SerialName("number") val number: String? = null,
    @SerialName("pin") val pin: String? = null,
    @SerialName("amount") val amount: Double? = null,
    @SerialName("currency") val currency: String? = null,
)

@Serializable
data class Geloescht(
    @SerialName("success") val success: Boolean,
    @SerialName("deleted") val deleted: Long,
)

@Serializable
data class Gesundheit(
    @SerialName("status") val status: String,
    @SerialName("startup") val startup: StartupStatus? = null,
    @SerialName("db_pool") val dbPool: JsonObject? = null,
    @SerialName("uptime_seconds") val uptimeSeconds: Long? = null,
)

@Serializable
data class GetrenntesKonto(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
    @SerialName("via") val via: String? = null,
)

@Serializable
data class GuthabenAntwort(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("voucher") val voucher: Gutschein? = null,
    @SerialName("angezeigt") val angezeigt: String? = null,
    @SerialName("waehrung_geaendert") val waehrungGeaendert: Boolean? = null,
    @SerialName("grund") val grund: String? = null,
    @SerialName("wartenSek") val wartenSek: Long? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String? = null,
)

@Serializable
data class Gutschein(
    @SerialName("id") val id: Long,
    @SerialName("number") val number: String,
    @SerialName("pin") val pin: String? = null,
    @SerialName("amount") val amount: Double,
    @SerialName("currency") val currency: String,
    @SerialName("hat_pdf") val hatPdf: Boolean,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("guthaben_geprueft_am") val guthabenGeprueftAm: String? = null,
)

@Serializable
data class GutscheinAntwort(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("voucher") val voucher: Gutschein? = null,
    @SerialName("mehrere") val mehrere: GutscheinStapel? = null,
    @SerialName("gelesen") val gelesen: GelesenerGutschein? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String? = null,
)

@Serializable
data class GutscheinKlartext(
    @SerialName("success") val success: Boolean,
    @SerialName("id") val id: Long,
    @SerialName("number") val number: String,
    @SerialName("pin") val pin: String? = null,
)

@Serializable
data class GutscheinListe(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long,
    @SerialName("page") val page: Long,
    @SerialName("page_size") val pageSize: Long,
    @SerialName("vouchers") val vouchers: List<Gutschein>,
)

@Serializable
data class GutscheinStapel(
    @SerialName("results") val results: List<JsonElement?>? = null,
    @SerialName("added") val added: Long? = null,
    @SerialName("updated") val updated: Long? = null,
    @SerialName("errors") val errors: Long? = null,
    @SerialName("total") val total: Long? = null,
)

@Serializable
data class HouseholdInviteCheckResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("inviter") val inviter: HouseholdInviteCheckResponseInviter,
)

@Serializable
data class HouseholdInviteCheckResponseInviter(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class HouseholdInviteResponse(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("expires_in") val expiresIn: Long? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class HouseholdMember(
    @SerialName("tiefe") val tiefe: Long? = null,
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
    @SerialName("is_self") val isSelf: Boolean,
)

@Serializable
data class HouseholdMembersResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("members") val members: List<HouseholdMember>,
)

@Serializable
data class HouseholdStatusResponse(
    @SerialName("blickfeld") val blickfeld: List<HouseholdMember>? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("is_main") val isMain: Boolean,
    @SerialName("is_sub") val isSub: Boolean,
    @SerialName("currency") val currency: String,
    @SerialName("linked_to") val linkedTo: HouseholdStatusResponseLinkedTo? = null,
    @SerialName("parents") val parents: List<HouseholdStatusResponseParentsEintrag>,
    @SerialName("sub_accounts") val subAccounts: List<HouseholdMember>,
    @SerialName("open_invites") val openInvites: Long,
    @SerialName("former_links") val formerLinks: List<GetrenntesKonto>,
    @SerialName("error") val error: String? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
)

@Serializable
data class HouseholdStatusResponseLinkedTo(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class HouseholdStatusResponseParentsEintrag(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class Instruction(
    @SerialName("downloaded_at") val downloadedAt: String? = null,
    @SerialName("fetched_at") val fetchedAt: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("user_id") val userId: Long? = null,
    @SerialName("id") val id: Long? = null,
    @SerialName("url") val url: String,
    @SerialName("description") val description: String? = null,
    @SerialName("local_path") val localPath: String? = null,
    @SerialName("is_manual") val isManual: Boolean,
)

@Serializable
data class JahrAnzahl(
    @SerialName("year") val year: Long? = null,
    @SerialName("n") val n: Long,
)

@Serializable
data class JobProzess(
    @SerialName("lebenszeichen") val lebenszeichen: String? = null,
    @SerialName("alter_sekunden") val alterSekunden: Long? = null,
    @SerialName("laeuft") val laeuft: Boolean,
)

@Serializable
data class JobSchedule(
    @SerialName("type") val type: String,
    @SerialName("time") val time: String? = null,
    @SerialName("minutes") val minutes: Long? = null,
)

@Serializable
data class JobStatus(
    @SerialName("lastRun") val lastRun: JsonElement? = null,
    @SerialName("canRedownload") val canRedownload: Boolean? = null,
    @SerialName("queue") val queue: Long? = null,
    @SerialName("queueLastRun") val queueLastRun: JsonElement? = null,
    @SerialName("label") val label: String,
    @SerialName("status") val status: String,
    @SerialName("progress") val progress: Long,
    @SerialName("total") val total: Long,
    @SerialName("sub") val sub: String? = null,
    @SerialName("sub_teile") val subTeile: List<JobStatusSubTeileEintrag>? = null,
)

@Serializable
data class JobStatusSubTeileEintrag(
    @SerialName("code") val code: String,
    @SerialName("werte") val werte: JsonObject? = null,
    @SerialName("vor") val vor: String? = null,
)

@Serializable
data class JobsResponse(
    @SerialName("db") val db: JsonObject? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("jobs") val jobs: JsonObject,
    @SerialName("schedules") val schedules: JsonObject,
    @SerialName("degradiert") val degradiert: List<String>? = null,
    @SerialName("proxy_hinweis") val proxyHinweis: JobsResponseProxyHinweis? = null,
)

@Serializable
data class JobsResponseProxyHinweis(
    @SerialName("art") val art: String,
    @SerialName("vars") val vars: JobsResponseProxyHinweisVars,
)

@Serializable
data class JobsResponseProxyHinweisVars(
    @SerialName("ip") val ip: String,
    @SerialName("minuten") val minuten: Long? = null,
    @SerialName("anzahl") val anzahl: Long? = null,
)

@Serializable
data class KonfigExport(
    @SerialName("version") val version: String? = null,
    @SerialName("exported_at") val exportedAt: String? = null,
    @SerialName("exported_by") val exportedBy: String? = null,
    @SerialName("global") val global: JsonObject? = null,
    @SerialName("user_settings") val userSettings: JsonObject? = null,
)

@Serializable
data class KontenListe(
    @SerialName("success") val success: Boolean,
    @SerialName("users") val users: List<KontoInListe>,
)

@Serializable
data class KontoAktiv(
    @SerialName("success") val success: Boolean,
    @SerialName("is_active") val isActive: Boolean,
)

@Serializable
data class KontoInListe(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
    @SerialName("is_admin") val isAdmin: Boolean,
    @SerialName("is_active") val isActive: Boolean,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("zweiter_faktor") val zweiterFaktor: Boolean,
    @SerialName("wartet_auf_bestaetigung") val wartetAufBestaetigung: Boolean? = null,
)

@Serializable
data class Lagerort(
    @SerialName("figuren") val figuren: Long? = null,
    @SerialName("ort") val ort: String,
    @SerialName("sets") val sets: Long,
    @SerialName("teile") val teile: Long,
)

@Serializable
data class LagerortEintrag(
    @SerialName("id") val id: Long,
    @SerialName("user_id") val userId: Long,
    @SerialName("name") val name: String,
)

@Serializable
data class LagerortEintragResponse(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("ort") val ort: LagerortEintrag? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class LagerortResponse(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("changed") val changed: Long? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class LagerortVorgabeResponse(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("vorgabe") val vorgabe: LagerortEintrag? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class LagerortVorratResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("orte") val orte: List<LagerortEintrag>,
    @SerialName("vorgabe") val vorgabe: LagerortEintrag? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class LagerorteResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("orte") val orte: List<Lagerort>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Lebenszeichen(
    @SerialName("status") val status: String,
)

@Serializable
data class LoginResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("user") val user: AnmeldeNutzer? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("zweiter_faktor") val zweiterFaktor: Boolean? = null,
    @SerialName("never_expires") val neverExpires: Boolean? = null,
    @SerialName("token_info") val tokenInfo: TokenAngaben? = null,
)

@Serializable
data class ManualFigsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long,
    @SerialName("page") val page: Long,
    @SerialName("page_size") val pageSize: Long,
    @SerialName("figs") val figs: List<ManualFigsResponseFigsEintrag>,
    @SerialName("error") val error: String? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
)

@Serializable
data class ManualFigsResponseFigsEintrag(
    @SerialName("ausstehend") val ausstehend: Boolean? = null,
    @SerialName("from_cache") val fromCache: Boolean? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("storage_id") val storageId: Long? = null,
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("id") val id: Long? = null,
    @SerialName("fig_number") val figNumber: String,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("quantity") val quantity: Long,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("display_value") val displayValue: String? = null,
    @SerialName("total_value") val totalValue: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("conditions") val conditions: List<String>,
    @SerialName("user_id") val userId: Long? = null,
    @SerialName("owners") val owners: List<ManualFigsResponseFigsEintragOwnersEintrag>? = null,
    @SerialName("acquisitions") val acquisitions: List<ManualFigsResponseFigsEintragAcquisitionsEintrag>? = null,
    @SerialName("storage") val storage: String? = null,
)

@Serializable
data class ManualFigsResponseFigsEintragOwnersEintrag(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class ManualFigsResponseFigsEintragAcquisitionsEintrag(
    @SerialName("id") val id: Long,
    @SerialName("condition") val condition: String,
    @SerialName("quantity") val quantity: Long,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Long? = null,
    @SerialName("kaufpreis_original") val kaufpreisOriginal: Double? = null,
    @SerialName("kaufpreis_waehrung") val kaufpreisWaehrung: String? = null,
    @SerialName("price_estimated") val priceEstimated: Boolean? = null,
)

@Serializable
data class ManualPartsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long,
    @SerialName("page") val page: Long,
    @SerialName("page_size") val pageSize: Long,
    @SerialName("parts") val parts: List<ManualPartsResponsePartsEintrag>,
    @SerialName("error") val error: String? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
)

@Serializable
data class ManualPartsResponsePartsEintrag(
    @SerialName("ausstehend") val ausstehend: Boolean? = null,
    @SerialName("from_cache") val fromCache: Boolean? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("id") val id: Long? = null,
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Long,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("quantity") val quantity: Long,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("display_value") val displayValue: String? = null,
    @SerialName("total_value") val totalValue: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("conditions") val conditions: List<String>,
    @SerialName("user_id") val userId: Long? = null,
    @SerialName("owners") val owners: List<ManualPartsResponsePartsEintragOwnersEintrag>? = null,
    @SerialName("acquisitions") val acquisitions: List<ManualPartsResponsePartsEintragAcquisitionsEintrag>? = null,
    @SerialName("storage") val storage: String? = null,
)

@Serializable
data class ManualPartsResponsePartsEintragOwnersEintrag(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class ManualPartsResponsePartsEintragAcquisitionsEintrag(
    @SerialName("id") val id: Long,
    @SerialName("condition") val condition: String,
    @SerialName("quantity") val quantity: Long,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Long? = null,
    @SerialName("kaufpreis_original") val kaufpreisOriginal: Double? = null,
    @SerialName("kaufpreis_waehrung") val kaufpreisWaehrung: String? = null,
    @SerialName("price_estimated") val priceEstimated: Boolean? = null,
)

@Serializable
data class MeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("loggedIn") val loggedIn: Boolean,
    @SerialName("user") val user: MeResponseUser? = null,
    @SerialName("token_expires") val tokenExpires: String? = null,
    @SerialName("token_last_used") val tokenLastUsed: String? = null,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
)

@Serializable
data class MeResponseUser(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
    @SerialName("is_admin") val isAdmin: Boolean,
    @SerialName("mustChangePassword") val mustChangePassword: Boolean? = null,
    @SerialName("zweiterFaktorPflicht") val zweiterFaktorPflicht: Boolean,
)

@Serializable
data class MengeGeaendert(
    @SerialName("new_quantity") val newQuantity: Long? = null,
    @SerialName("from_user_id") val fromUserId: Long? = null,
    @SerialName("to_user_id") val toUserId: Long? = null,
    @SerialName("merged") val merged: Boolean? = null,
    @SerialName("unchanged") val unchanged: Boolean? = null,
    @SerialName("acquisitions") val acquisitions: Long? = null,
    @SerialName("instructions") val instructions: Long? = null,
    @SerialName("papierkorb") val papierkorb: JsonElement? = null,
    @SerialName("removed") val removed: Long? = null,
    @SerialName("linked_to") val linkedTo: MengeGeaendertLinkedTo? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("set") val set: MengeGeaendertSet? = null,
    @SerialName("parts") val parts: Long? = null,
    @SerialName("minifigs") val minifigs: Long? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean? = null,
    @SerialName("quantity") val quantity: Long? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
    @SerialName("entfallen") val entfallen: List<MengeGeaendertEntfallenEintrag>? = null,
)

@Serializable
data class MengeGeaendertLinkedTo(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class MengeGeaendertSet(
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("conditions") val conditions: List<String>? = null,
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
)

@Serializable
data class MengeGeaendertEntfallenEintrag(
    @SerialName("id") val id: Long,
    @SerialName("quantity") val quantity: Long,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("currency") val currency: String? = null,
    @SerialName("price_estimated") val priceEstimated: Boolean,
    @SerialName("condition") val condition: String,
    @SerialName("date") val date: String? = null,
)

@Serializable
data class MerklisteResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long,
    @SerialName("page") val page: Long,
    @SerialName("page_size") val pageSize: Long,
    @SerialName("merkposten") val merkposten: List<Merkposten>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Merkposten(
    @SerialName("theme_id") val themeId: Long? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("condition") val condition: String,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("user_id") val userId: Long,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Long? = null,
    @SerialName("num_parts") val numParts: Long? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("marktpreis") val marktpreis: Double? = null,
    @SerialName("waehrung") val waehrung: String,
    @SerialName("owned") val owned: Boolean,
    @SerialName("alarm") val alarm: MerkpostenAlarm? = null,
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null,
)

@Serializable
data class MerkpostenAlarm(
    @SerialName("richtung") val richtung: String,
    @SerialName("schwelle") val schwelle: Double,
    @SerialName("ausgeloest") val ausgeloest: Boolean,
)

@Serializable
data class MerkpostenAntwort(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("war_neu") val warNeu: Boolean? = null,
    @SerialName("merkposten") val merkposten: Merkposten? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class MerkpostenGeloescht(
    @SerialName("new_quantity") val newQuantity: Long? = null,
    @SerialName("from_user_id") val fromUserId: Long? = null,
    @SerialName("to_user_id") val toUserId: Long? = null,
    @SerialName("merged") val merged: Boolean? = null,
    @SerialName("unchanged") val unchanged: Boolean? = null,
    @SerialName("acquisitions") val acquisitions: Long? = null,
    @SerialName("instructions") val instructions: Long? = null,
    @SerialName("papierkorb") val papierkorb: JsonElement? = null,
    @SerialName("removed") val removed: Long? = null,
    @SerialName("linked_to") val linkedTo: MerkpostenGeloeschtLinkedTo? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("set") val set: MerkpostenGeloeschtSet? = null,
    @SerialName("parts") val parts: Long? = null,
    @SerialName("minifigs") val minifigs: Long? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean? = null,
    @SerialName("quantity") val quantity: Long? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
    @SerialName("geloescht") val geloescht: Long,
)

@Serializable
data class MerkpostenGeloeschtLinkedTo(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class MerkpostenGeloeschtSet(
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("conditions") val conditions: List<String>? = null,
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
)

@Serializable
data class MerkpostenInhaberAntwort(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("verschoben") val verschoben: Boolean? = null,
    @SerialName("zusammengefuehrt") val zusammengefuehrt: Boolean? = null,
    @SerialName("owner_user_id") val ownerUserId: Long? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class MerkpostenPreiseResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("currency") val currency: String,
    @SerialName("current") val current: CurrentByCondition,
    @SerialName("error") val error: String? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
)

@Serializable
data class MerkpostenUebernahmeResponse(
    @SerialName("katalog_offen") val katalogOffen: Boolean? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("success") val success: Boolean? = null,
    @SerialName("action") val action: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class MinifigStats(
    @SerialName("unique_figs") val uniqueFigs: Long? = null,
    @SerialName("types") val types: Long,
    @SerialName("total_quantity") val totalQuantity: Long,
    @SerialName("manual") val manual: Long,
)

@Serializable
data class MinifigStatsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("stats") val stats: MinifigStats,
)

@Serializable
data class MoveSetResponse(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("quantity") val quantity: Long? = null,
    @SerialName("acquisitions") val acquisitions: Long? = null,
    @SerialName("merged") val merged: Boolean? = null,
    @SerialName("parts") val parts: Long? = null,
    @SerialName("minifigs") val minifigs: Long? = null,
    @SerialName("instructions") val instructions: Long? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean? = null,
    @SerialName("from_user_id") val fromUserId: Long? = null,
    @SerialName("to_user_id") val toUserId: Long? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class POSTApiV1AuthEmailBestaetigenVorschau(
    @SerialName("success") val success: Boolean,
    @SerialName("username") val username: String,
)

@Serializable
data class POSTApiV1MinifigsImportCsv(
    @SerialName("results") val results: List<POSTApiV1MinifigsImportCsvResultsEintrag>? = null,
    @SerialName("waehrung_hinweis") val waehrungHinweis: String? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("skipped") val skipped: Long? = null,
    @SerialName("skipped_hint") val skippedHint: String? = null,
    @SerialName("total") val total: Long? = null,
    @SerialName("added") val added: Long? = null,
    @SerialName("imported") val imported: Long? = null,
    @SerialName("updated") val updated: Long? = null,
    @SerialName("errors") val errors: Long? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("gestartet") val gestartet: Boolean? = null,
    @SerialName("vorhanden") val vorhanden: Long? = null,
    @SerialName("vorhanden_nummern") val vorhandenNummern: List<String>? = null,
)

@Serializable
data class POSTApiV1MinifigsImportCsvResultsEintrag(
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("zeile") val zeile: Long? = null,
    @SerialName("success") val success: Boolean? = null,
    @SerialName("action") val action: String? = null,
    @SerialName("isWarning") val isWarning: Boolean? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("menge") val menge: Long? = null,
    @SerialName("katalog_offen") val katalogOffen: Boolean? = null,
    @SerialName("part_number") val partNumber: String? = null,
    @SerialName("fig_number") val figNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("vars") val vars: JsonObject? = null,
    @SerialName("waehrung_angepasst") val waehrungAngepasst: Boolean? = null,
    @SerialName("waehrung_datei") val waehrungDatei: String? = null,
    @SerialName("waehrung_konto") val waehrungKonto: String? = null,
)

@Serializable
data class POSTApiV1SetsImportCsvCancel(
    @SerialName("dauer_minuten") val dauerMinuten: Long? = null,
    @SerialName("pending") val pending: Long? = null,
    @SerialName("queued") val queued: Long? = null,
    @SerialName("skipped") val skipped: Long? = null,
    @SerialName("verworfen") val verworfen: Long? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("enqueued") val enqueued: Long? = null,
)

@Serializable
data class PUTApiV1AuthUsersIdPassword(
    @SerialName("success") val success: Boolean,
    @SerialName("wirksam_ab") val wirksamAb: String? = null,
)

@Serializable
data class PUTApiV1SetsSetNumberAcquisitionsAcqId(
    @SerialName("new_quantity") val newQuantity: Long? = null,
    @SerialName("from_user_id") val fromUserId: Long? = null,
    @SerialName("to_user_id") val toUserId: Long? = null,
    @SerialName("merged") val merged: Boolean? = null,
    @SerialName("unchanged") val unchanged: Boolean? = null,
    @SerialName("acquisitions") val acquisitions: Long? = null,
    @SerialName("instructions") val instructions: Long? = null,
    @SerialName("papierkorb") val papierkorb: JsonElement? = null,
    @SerialName("removed") val removed: Long? = null,
    @SerialName("linked_to") val linkedTo: PUTApiV1SetsSetNumberAcquisitionsAcqIdLinkedTo? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("set") val set: PUTApiV1SetsSetNumberAcquisitionsAcqIdSet? = null,
    @SerialName("parts") val parts: Long? = null,
    @SerialName("minifigs") val minifigs: Long? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean? = null,
    @SerialName("quantity") val quantity: Long? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
)

@Serializable
data class PUTApiV1SetsSetNumberAcquisitionsAcqIdLinkedTo(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class PUTApiV1SetsSetNumberAcquisitionsAcqIdSet(
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("conditions") val conditions: List<String>? = null,
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
)

@Serializable
data class Papierkorb(
    @SerialName("success") val success: Boolean,
    @SerialName("eintraege") val eintraege: List<PapierkorbEintrag>,
)

@Serializable
data class PapierkorbEintrag(
    @SerialName("id") val id: Long,
    @SerialName("art") val art: String,
    @SerialName("nummer") val nummer: String,
    @SerialName("farbe_id") val farbeId: Long? = null,
    @SerialName("bezeichnung") val bezeichnung: String? = null,
    @SerialName("anzahl") val anzahl: Long,
    @SerialName("user_id") val userId: Long,
    @SerialName("geloescht_am") val geloeschtAm: String,
    @SerialName("endgueltig_am") val endgueltigAm: String,
)

@Serializable
data class PapierkorbGeleert(
    @SerialName("success") val success: Boolean,
    @SerialName("entfernt") val entfernt: Long,
)

@Serializable
data class PartsCategoriesResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("categories") val categories: List<PartsCategory>,
)

@Serializable
data class PartsCategory(
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("label") val label: String? = null,
    @SerialName("unique_parts") val uniqueParts: Long,
    @SerialName("total_quantity") val totalQuantity: Long,
)

@Serializable
data class PartsFilterColor(
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("unique_parts") val uniqueParts: Long,
    @SerialName("total_quantity") val totalQuantity: Long,
)

@Serializable
data class PartsFilterColorsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("colors") val colors: List<PartsFilterColor>,
)

@Serializable
data class PartsStats(
    @SerialName("unique_parts") val uniqueParts: Long,
    @SerialName("unique_colors") val uniqueColors: Long,
    @SerialName("total_parts") val totalParts: Long,
    @SerialName("manual_parts") val manualParts: Long? = null,
)

@Serializable
data class PartsStatsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("stats") val stats: PartsStats? = null,
)

@Serializable
data class PartsValuationResponse(
    @SerialName("kaufpreise_umgerechnet") val kaufpreiseUmgerechnet: Long? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long,
    @SerialName("page") val page: Long,
    @SerialName("page_size") val pageSize: Long,
    @SerialName("currency") val currency: String,
    @SerialName("parts") val parts: List<PartsValuationResponsePartsEintrag>,
    @SerialName("total_value") val totalValue: String,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("preise_ausstehend") val preiseAusstehend: Long? = null,
    @SerialName("kaufpreise_fremde_waehrung") val kaufpreiseFremdeWaehrung: Long,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class PartsValuationResponsePartsEintrag(
    @SerialName("ausstehend") val ausstehend: Boolean? = null,
    @SerialName("from_cache") val fromCache: Boolean? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("id") val id: Long? = null,
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Long,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("quantity") val quantity: Long,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("display_value") val displayValue: String? = null,
    @SerialName("total_value") val totalValue: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("conditions") val conditions: List<String>,
    @SerialName("user_id") val userId: Long? = null,
    @SerialName("owners") val owners: List<PartsValuationResponsePartsEintragOwnersEintrag>? = null,
    @SerialName("acquisitions") val acquisitions: List<PartsValuationResponsePartsEintragAcquisitionsEintrag>,
    @SerialName("storage") val storage: String? = null,
)

@Serializable
data class PartsValuationResponsePartsEintragOwnersEintrag(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class PartsValuationResponsePartsEintragAcquisitionsEintrag(
    @SerialName("id") val id: Long,
    @SerialName("condition") val condition: String,
    @SerialName("quantity") val quantity: Long,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Long? = null,
    @SerialName("kaufpreis_original") val kaufpreisOriginal: Double? = null,
    @SerialName("kaufpreis_waehrung") val kaufpreisWaehrung: String? = null,
    @SerialName("price_estimated") val priceEstimated: Boolean? = null,
)

@Serializable
data class Passkey(
    @SerialName("id") val id: Long,
    @SerialName("name") val name: String? = null,
    @SerialName("transports") val transports: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("last_used") val lastUsed: String? = null,
)

@Serializable
data class PasskeyAngelegt(
    @SerialName("success") val success: Boolean,
    @SerialName("passkey") val passkey: PasskeyAngelegtPasskey,
)

@Serializable
data class PasskeyAngelegtPasskey(
    @SerialName("id") val id: Long,
    @SerialName("name") val name: String,
)

@Serializable
data class PasskeyAnmeldung(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("user") val user: PasskeyAnmeldungUser,
    @SerialName("error") val error: String? = null,
    @SerialName("zweiter_faktor") val zweiterFaktor: Boolean? = null,
    @SerialName("never_expires") val neverExpires: Boolean? = null,
    @SerialName("token_info") val tokenInfo: TokenAngaben? = null,
)

@Serializable
data class PasskeyAnmeldungUser(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
    @SerialName("is_admin") val isAdmin: Boolean,
    @SerialName("mustChangePassword") val mustChangePassword: Boolean? = null,
    @SerialName("zweiterFaktorPflicht") val zweiterFaktorPflicht: Boolean? = null,
)

@Serializable
data class PasskeyListe(
    @SerialName("success") val success: Boolean,
    @SerialName("verfuegbar") val verfuegbar: Boolean,
    @SerialName("passkeys") val passkeys: List<Passkey>,
)

@Serializable
data class PasskeyOptionen(
    @SerialName("success") val success: Boolean,
    @SerialName("optionen") val optionen: JsonObject,
)

@Serializable
data class PdfAuftrag(
    @SerialName("success") val success: Boolean,
    @SerialName("jobId") val jobId: String,
)

@Serializable
data class PdfEingabe(
    @SerialName("sets") val sets: List<PdfEingabeSetsEintrag>? = null,
    @SerialName("parts") val parts: List<PdfEingabePartsEintrag>? = null,
)

@Serializable
data class PdfEingabeSetsEintrag(
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
)

@Serializable
data class PdfEingabePartsEintrag(
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("color_id") val colorId: Int? = null,
    @SerialName("quantity") val quantity: JsonElement? = null,
    @SerialName("is_fig") val isFig: JsonElement? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
)

@Serializable
data class PdfFreigabe(
    @SerialName("success") val success: Boolean,
    @SerialName("ticket") val ticket: String,
    @SerialName("gueltig_sek") val gueltigSek: Long,
)

@Serializable
data class PdfStand(
    @SerialName("success") val success: Boolean,
    @SerialName("status") val status: String,
    @SerialName("error") val error: String? = null,
    @SerialName("etaSeconds") val etaSeconds: Double? = null,
    @SerialName("missingImages") val missingImages: JsonElement? = null,
)

@Serializable
data class PendingAlertsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("alerts") val alerts: List<Preisalarm>,
    @SerialName("now") val now: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class PnlResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long,
    @SerialName("page") val page: Long,
    @SerialName("page_size") val pageSize: Long,
    @SerialName("currency") val currency: String,
    @SerialName("totals") val totals: PnlTotals,
    @SerialName("sets") val sets: List<PnlSetZeile>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class PnlSetZeile(
    @SerialName("added_at") val addedAt: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("pnl_abs") val pnlAbs: String? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("year") val year: Long? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("quantity") val quantity: Long,
    @SerialName("current_price") val currentPrice: Double? = null,
    @SerialName("baseline_price") val baselinePrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("baseline_pnl_pct") val baselinePnlPct: String? = null,
    @SerialName("pnl_betrag") val pnlBetrag: Double? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("baseline_pnl_prozent") val baselinePnlProzent: Double? = null,
    @SerialName("kachel_preis") val kachelPreis: Double? = null,
    @SerialName("kachel_pnl_pct") val kachelPnlPct: Double? = null,
    @SerialName("kachel_quelle") val kachelQuelle: String? = null,
)

@Serializable
data class PnlTotals(
    @SerialName("kaufpreise_umgerechnet") val kaufpreiseUmgerechnet: Long? = null,
    @SerialName("pnl_current") val pnlCurrent: JsonElement? = null,
    @SerialName("pnl_purchase") val pnlPurchase: JsonElement? = null,
    @SerialName("purchase") val purchase: String,
    @SerialName("current") val current: String,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("kaufpreise_fremde_waehrung") val kaufpreiseFremdeWaehrung: Long,
    @SerialName("sets_purchase") val setsPurchase: String? = null,
    @SerialName("parts_purchase") val partsPurchase: String? = null,
    @SerialName("figs_purchase") val figsPurchase: String? = null,
    @SerialName("grand_total") val grandTotal: String? = null,
    @SerialName("positionen") val positionen: Long? = null,
    @SerialName("positionen_bewertet") val positionenBewertet: Long? = null,
    @SerialName("positionen_ohne_marktpreis") val positionenOhneMarktpreis: Long? = null,
    @SerialName("positionen_ohne_kaufpreis") val positionenOhneKaufpreis: Long? = null,
    @SerialName("basis_einstand") val basisEinstand: String? = null,
    @SerialName("basis_marktwert") val basisMarktwert: String? = null,
    @SerialName("basis_guv_betrag") val basisGuvBetrag: String? = null,
    @SerialName("ohne_marktpreis_einstand") val ohneMarktpreisEinstand: String? = null,
    @SerialName("ohne_kaufpreis_marktwert") val ohneKaufpreisMarktwert: String? = null,
)

@Serializable
data class PortfolioHistoryResponse(
    @SerialName("chart") val chart: PriceChartData? = null,
    @SerialName("messpunkte") val messpunkte: Long? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("currency") val currency: String,
    @SerialName("period") val period: String,
    @SerialName("points") val points: List<ChartPoint>,
    @SerialName("y_axis") val yAxis: List<ChartYAxis>,
    @SerialName("period_change_pct") val periodChangePct: Double? = null,
    @SerialName("purchase_total") val purchaseTotal: String? = null,
)

@Serializable
data class PreisJobStand(
    @SerialName("success") val success: Boolean,
    @SerialName("job") val job: PreisJobStandJob,
    @SerialName("rate_limit") val rateLimit: PreisJobStandRateLimit,
)

@Serializable
data class PreisJobStandJob(
    @SerialName("running") val running: Boolean,
    @SerialName("lastRun") val lastRun: String? = null,
    @SerialName("nextRun") val nextRun: String? = null,
    @SerialName("lastErrors") val lastErrors: Long,
    @SerialName("log") val log: List<JsonElement?>,
    @SerialName("lastDuration") val lastDuration: Double? = null,
    @SerialName("lastUpdated") val lastUpdated: Double? = null,
    @SerialName("progress") val progress: PreisJobStandJobProgress? = null,
)

@Serializable
data class PreisJobStandJobProgress(
    @SerialName("current") val current: JsonElement? = null,
    @SerialName("total") val total: JsonElement? = null,
    @SerialName("set") val set: JsonElement? = null,
)

@Serializable
data class PreisJobStandRateLimit(
    @SerialName("count") val count: Long,
    @SerialName("limit") val limit: Long,
    @SerialName("remaining") val remaining: Long,
    @SerialName("date") val date: String? = null,
)

@Serializable
data class Preisalarm(
    @SerialName("set_number") val setNumber: String,
    @SerialName("condition") val condition: String,
    @SerialName("richtung") val richtung: String,
    @SerialName("schwelle") val schwelle: Double,
    @SerialName("currency_code") val currencyCode: String,
    @SerialName("ausgeloest") val ausgeloest: Boolean,
    @SerialName("zuletzt_am") val zuletztAm: String? = null,
    @SerialName("zuletzt_preis") val zuletztPreis: Double? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("set_img_url") val setImgUrl: String? = null,
    @SerialName("besitzt") val besitzt: Boolean,
)

@Serializable
data class PreisalarmResponse(
    @SerialName("success") val success: Boolean? = null,
    @SerialName("alert") val alert: Preisalarm? = null,
    @SerialName("removed") val removed: Long? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class PreisalarmeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("alerts") val alerts: List<Preisalarm>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class PriceByCondition(
    @SerialName("N") val n: ConditionValuation? = null,
    @SerialName("U") val u: ConditionValuation? = null,
)

@Serializable
data class PriceChartData(
    @SerialName("values") val values: List<PriceChartSeries>,
    @SerialName("x") val x: List<String>,
)

@Serializable
data class PriceChartPoint(
    @SerialName("x") val x: String,
    @SerialName("y") val y: Double,
)

@Serializable
data class PriceChartSeries(
    @SerialName("name") val name: String,
    @SerialName("values") val values: List<PriceChartPoint>,
    @SerialName("firstRealIndex") val firstRealIndex: Long,
)

@Serializable
data class PriceHistoryPoint(
    @SerialName("is_purchase_price") val isPurchasePrice: Boolean? = null,
    @SerialName("recorded_at") val recordedAt: String,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
)

@Serializable
data class PriceHistoryResponse(
    @SerialName("condition") val condition: String? = null,
    @SerialName("current") val current: JsonElement? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("currency") val currency: String,
    @SerialName("history_new") val historyNew: List<PriceHistoryPoint>,
    @SerialName("history_used") val historyUsed: List<PriceHistoryPoint>,
    @SerialName("by_condition") val byCondition: PriceByCondition,
    @SerialName("chart") val chart: PriceChartData,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
)

@Serializable
data class Profil(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
    @SerialName("email") val email: String? = null,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    @SerialName("email_verified") val emailVerified: Boolean,
    @SerialName("email_neu") val emailNeu: String? = null,
)

@Serializable
data class ProfilGespeichert(
    @SerialName("new_quantity") val newQuantity: Long? = null,
    @SerialName("from_user_id") val fromUserId: Long? = null,
    @SerialName("to_user_id") val toUserId: Long? = null,
    @SerialName("merged") val merged: Boolean? = null,
    @SerialName("unchanged") val unchanged: Boolean? = null,
    @SerialName("acquisitions") val acquisitions: Long? = null,
    @SerialName("instructions") val instructions: Long? = null,
    @SerialName("papierkorb") val papierkorb: JsonElement? = null,
    @SerialName("removed") val removed: Long? = null,
    @SerialName("linked_to") val linkedTo: ProfilGespeichertLinkedTo? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("set") val set: ProfilGespeichertSet? = null,
    @SerialName("parts") val parts: Long? = null,
    @SerialName("minifigs") val minifigs: Long? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean? = null,
    @SerialName("quantity") val quantity: Long? = null,
    @SerialName("degradiert") val degradiert: List<String>? = null,
    @SerialName("emailChanged") val emailChanged: Boolean? = null,
    @SerialName("emailSent") val emailSent: Boolean? = null,
)

@Serializable
data class ProfilGespeichertLinkedTo(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class ProfilGespeichertSet(
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("conditions") val conditions: List<String>? = null,
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
)

@Serializable
data class ProfilResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("user") val user: Profil? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class ProtokollEintraege(
    @SerialName("success") val success: Boolean,
    @SerialName("eintraege") val eintraege: List<JsonObject>,
)

@Serializable
data class ProtokollResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("minutes") val minutes: Long,
    @SerialName("count") val count: Long,
    @SerialName("logs") val logs: List<ProtokollZeile>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class ProtokollZeile(
    @SerialName("id") val id: Long? = null,
    @SerialName("level") val level: String? = null,
    @SerialName("message") val message: String? = null,
    @SerialName("logged_at") val loggedAt: String? = null,
)

@Serializable
data class QrAbholung(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("user") val user: AnmeldeNutzer? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("zweiter_faktor") val zweiterFaktor: Boolean? = null,
    @SerialName("never_expires") val neverExpires: Boolean? = null,
    @SerialName("token_info") val tokenInfo: TokenAngaben? = null,
    @SerialName("wartet") val wartet: Boolean,
    @SerialName("username") val username: String? = null,
    @SerialName("isAdmin") val isAdmin: Boolean? = null,
    @SerialName("userId") val userId: Long? = null,
    @SerialName("vorschau") val vorschau: Boolean? = null,
    @SerialName("schluessel_nonce") val schluesselNonce: String? = null,
)

@Serializable
data class QrKopplungStand(
    @SerialName("success") val success: Boolean,
    @SerialName("stand") val stand: String,
    @SerialName("geraet") val geraet: String? = null,
    @SerialName("ip_bereich") val ipBereich: String? = null,
)

@Serializable
data class QrMeldung(
    @SerialName("success") val success: Boolean,
    @SerialName("wartet") val wartet: Boolean,
    @SerialName("abholung") val abholung: String,
    @SerialName("code") val code: String,
    @SerialName("expires_in") val expiresIn: Long,
)

@Serializable
data class QrToken(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String,
    @SerialName("kopplung") val kopplung: Long,
    @SerialName("expires_in") val expiresIn: Long,
    @SerialName("url") val url: String,
    @SerialName("token_days") val tokenDays: Long? = null,
    @SerialName("fp") val fp: String? = null,
    @SerialName("zert_sha256") val zertSha256: String? = null,
)

@Serializable
data class RateLimit(
    @SerialName("date") val date: String? = null,
    @SerialName("count") val count: Long,
    @SerialName("limit") val limit: Long,
    @SerialName("remaining") val remaining: Long,
)

@Serializable
data class RateLimits(
    @SerialName("bricklink") val bricklink: RateLimit,
    @SerialName("rebrickable") val rebrickable: RateLimit,
    @SerialName("brickset") val brickset: RateLimit,
)

@Serializable
data class RegisterResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("message") val message: String? = null,
    @SerialName("email_sent") val emailSent: Boolean? = null,
    @SerialName("console_mode") val consoleMode: Boolean? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class RegistrationStatusResponse(
    @SerialName("enabled") val enabled: Boolean,
    @SerialName("passkey") val passkey: Boolean? = null,
    @SerialName("passwort_vergessen") val passwortVergessen: Boolean? = null,
    @SerialName("mail_versand") val mailVersand: Boolean? = null,
)

@Serializable
data class RoheEinstellungen(
    @SerialName("success") val success: Boolean,
    @SerialName("settings") val settings: JsonObject,
)

@Serializable
data class SchluesselNonce(
    @SerialName("success") val success: Boolean,
    @SerialName("nonce") val nonce: String,
)

@Serializable
data class SchrittChallenge(
    @SerialName("success") val success: Boolean,
    @SerialName("challenge") val challenge: String,
    @SerialName("nachricht") val nachricht: String,
    @SerialName("gueltig_bis") val gueltigBis: String,
)

@Serializable
data class SchrittFreigabe(
    @SerialName("success") val success: Boolean,
    @SerialName("aktion") val aktion: String,
    @SerialName("gueltig_bis") val gueltigBis: String,
)

@Serializable
data class SetExistsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("exists") val exists: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("owner_user_id") val ownerUserId: Long? = null,
    @SerialName("is_self") val isSelf: Boolean? = null,
)

@Serializable
data class SetInfoResponse(
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("minifigs") val minifigs: Long? = null,
    @SerialName("pieces") val pieces: Long? = null,
    @SerialName("theme") val theme: String? = null,
    @SerialName("year") val year: Long? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("im_katalog") val imKatalog: Boolean? = null,
)

@Serializable
data class SetItem(
    @SerialName("acq_count") val acqCount: Long? = null,
    @SerialName("letzter_kauf") val letzterKauf: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Long>? = null,
    @SerialName("id") val id: Long? = null,
    @SerialName("storage_id") val storageId: Long? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("user_id") val userId: Long? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Long? = null,
    @SerialName("theme") val theme: String? = null,
    @SerialName("pieces") val pieces: Long? = null,
    @SerialName("minifigs") val minifigs: Long? = null,
    @SerialName("quantity") val quantity: Long,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("added_at") val addedAt: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("conditions") val conditions: List<String>,
    @SerialName("owners") val owners: List<SetItemOwnersEintrag>? = null,
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("kaufpreis_geschaetzt") val kaufpreisGeschaetzt: Boolean? = null,
    @SerialName("used_count") val usedCount: Long? = null,
    @SerialName("instructions") val instructions: List<Instruction>,
    @SerialName("bricklink") val bricklink: SetItemBricklink? = null,
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null,
)

@Serializable
data class SetItemOwnersEintrag(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class SetItemBricklink(
    @SerialName("type") val type: String,
    @SerialName("number") val number: String,
    @SerialName("url") val url: String? = null,
    @SerialName("exact") val exact: Boolean,
    @SerialName("resolved") val resolved: Boolean,
)

@Serializable
data class SetPriceResponse(
    @SerialName("from_cache") val fromCache: Boolean? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("currency") val currency: String,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("no_price") val noPrice: Boolean,
)

@Serializable
data class SetResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set") val set: SetItem? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class SetsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("count") val count: Long,
    @SerialName("sets") val sets: List<SetItem>,
    @SerialName("total") val total: Long,
    @SerialName("themes") val themes: List<String>? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class SettingsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("settings") val settings: UserSettings,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Sicherung(
    @SerialName("version") val version: String,
    @SerialName("exported_at") val exportedAt: String,
    @SerialName("exported_by") val exportedBy: String? = null,
    @SerialName("global") val global: JsonObject,
    @SerialName("user_settings") val userSettings: JsonObject,
)

@Serializable
data class SicherungEingespielt(
    @SerialName("success") val success: Boolean,
    @SerialName("imported") val imported: Long,
    @SerialName("note") val note: String,
    @SerialName("smtp_uebergangen") val smtpUebergangen: List<String>? = null,
)

@Serializable
data class SmtpProbe(
    @SerialName("mode") val mode: String? = null,
    @SerialName("success") val success: Boolean,
)

@Serializable
data class StartupStatus(
    @SerialName("fehler") val fehler: String? = null,
    @SerialName("pfad") val pfad: String? = null,
    @SerialName("ready") val ready: Boolean,
    @SerialName("step") val step: String? = null,
    @SerialName("progress") val progress: Double,
    @SerialName("total") val total: Long,
    @SerialName("sub") val sub: String? = null,
)

@Serializable
data class StatsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("stats") val stats: DashboardStats? = null,
)

@Serializable
data class TeilFarbeResponse(
    @SerialName("bild") val bild: String? = null,
    @SerialName("success") val success: Boolean? = null,
    @SerialName("zusammengelegt") val zusammengelegt: Boolean? = null,
    @SerialName("verschoben") val verschoben: Long? = null,
    @SerialName("vereint") val vereint: Long? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class TeileGeladen(
    @SerialName("success") val success: Boolean,
    @SerialName("count") val count: Long,
)

@Serializable
data class TlsStand(
    @SerialName("success") val success: Boolean,
    @SerialName("https") val https: Boolean,
    @SerialName("fp") val fp: String? = null,
    @SerialName("fp_hex") val fpHex: String? = null,
    @SerialName("zert_sha256") val zertSha256: String? = null,
    @SerialName("subject") val subject: String? = null,
    @SerialName("gueltig_bis") val gueltigBis: String? = null,
    @SerialName("download") val download: String? = null,
)

@Serializable
data class TokenAngaben(
    @SerialName("scope") val scope: String,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("hard_expires_at") val hardExpiresAt: String? = null,
    @SerialName("never_expires") val neverExpires: Boolean,
    @SerialName("rotiert_am") val rotiertAm: String? = null,
    @SerialName("rotation_faellig") val rotationFaellig: Boolean? = null,
)

@Serializable
data class TokenErstellt(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String,
    @SerialName("label") val label: String? = null,
    @SerialName("never_expires") val neverExpires: Boolean,
    @SerialName("token_info") val tokenInfo: TokenAngaben? = null,
)

@Serializable
data class TokenInfo(
    @SerialName("scope") val scope: String,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("hard_expires_at") val hardExpiresAt: String? = null,
    @SerialName("never_expires") val neverExpires: Boolean,
    @SerialName("rotiert_am") val rotiertAm: String? = null,
    @SerialName("rotation_faellig") val rotationFaellig: Boolean,
)

@Serializable
data class TokenRotation(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("token_info") val tokenInfo: TokenAngaben? = null,
    @SerialName("alt_gueltig_bis") val altGueltigBis: String? = null,
    @SerialName("ueberlappung_sek") val ueberlappungSek: Long? = null,
)

@Serializable
data class TokenWiderruf(
    @SerialName("success") val success: Boolean,
    @SerialName("deleted") val deleted: Long? = null,
)

@Serializable
data class TokensResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("tokens") val tokens: List<AppToken>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Totals(
    @SerialName("min") val min: String,
    @SerialName("avg") val avg: String,
    @SerialName("max") val max: String,
    @SerialName("qty_avg") val qtyAvg: String,
)

@Serializable
data class User(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
    @SerialName("is_admin") val isAdmin: Boolean,
)

@Serializable
data class UserSettings(
    @SerialName("currency") val currency: String,
    @SerialName("price_condition") val priceCondition: String,
    @SerialName("price_cache_ttl") val priceCacheTtl: String,
    @SerialName("default_price_condition") val defaultPriceCondition: String,
    @SerialName("user_default_condition") val userDefaultCondition: String? = null,
    @SerialName("effective_condition") val effectiveCondition: String,
    @SerialName("app_theme") val appTheme: String,
)

@Serializable
data class ValuationResponse(
    @SerialName("kaufpreise_umgerechnet") val kaufpreiseUmgerechnet: Long? = null,
    @SerialName("guide_type") val guideType: String? = null,
    @SerialName("ttl_hours") val ttlHours: JsonElement? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Long,
    @SerialName("page") val page: Long,
    @SerialName("page_size") val pageSize: Long,
    @SerialName("total_value") val totalValue: String,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("preise_ausstehend") val preiseAusstehend: Long? = null,
    @SerialName("currency") val currency: String,
    @SerialName("condition") val condition: String,
    @SerialName("ttl_stunden") val ttlStunden: Long? = null,
    @SerialName("kaufpreise_fremde_waehrung") val kaufpreiseFremdeWaehrung: Long,
    @SerialName("sets") val sets: List<ValuationSet>,
    @SerialName("totals") val totals: Totals,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class ValuationSet(
    @SerialName("bl_unbekannt") val blUnbekannt: Boolean? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("conditions") val conditions: List<String>? = null,
    @SerialName("error_code") val errorCode: String? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("user_id") val userId: Long? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("added_at") val addedAt: String? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Long? = null,
    @SerialName("quantity") val quantity: Long,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("total_qty_avg") val totalQtyAvg: String? = null,
    @SerialName("preis_ausstehend") val preisAusstehend: Boolean? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("from_cache") val fromCache: Boolean,
    @SerialName("is_fallback") val isFallback: Boolean,
    @SerialName("condition_used") val conditionUsed: String? = null,
    @SerialName("no_price") val noPrice: Boolean,
    @SerialName("acquisitions") val acquisitions: List<ValuationSetAcquisitionsEintrag>,
    @SerialName("mixed") val mixed: Boolean,
    @SerialName("owners") val owners: List<ValuationSetOwnersEintrag>? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class ValuationSetAcquisitionsEintrag(
    @SerialName("id") val id: Long,
    @SerialName("condition") val condition: String,
    @SerialName("quantity") val quantity: Long,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Long? = null,
    @SerialName("kaufpreis_original") val kaufpreisOriginal: Double? = null,
    @SerialName("kaufpreis_waehrung") val kaufpreisWaehrung: String? = null,
    @SerialName("price_estimated") val priceEstimated: Boolean? = null,
)

@Serializable
data class ValuationSetOwnersEintrag(
    @SerialName("id") val id: Long,
    @SerialName("username") val username: String,
)

@Serializable
data class VerwaltungDesign(
    @SerialName("dauer_minuten") val dauerMinuten: Long? = null,
    @SerialName("pending") val pending: Long? = null,
    @SerialName("queued") val queued: Long? = null,
    @SerialName("skipped") val skipped: Long? = null,
    @SerialName("verworfen") val verworfen: Long? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("enqueued") val enqueued: Long? = null,
    @SerialName("theme") val theme: String,
)

@Serializable
data class VerwaltungGestartet(
    @SerialName("dauer_minuten") val dauerMinuten: Long? = null,
    @SerialName("pending") val pending: Long? = null,
    @SerialName("queued") val queued: Long? = null,
    @SerialName("skipped") val skipped: Long? = null,
    @SerialName("verworfen") val verworfen: Long? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("enqueued") val enqueued: Long? = null,
    @SerialName("started") val started: Boolean,
)

@Serializable
data class VerwaltungMeldung(
    @SerialName("dauer_minuten") val dauerMinuten: Long? = null,
    @SerialName("pending") val pending: Long? = null,
    @SerialName("queued") val queued: Long? = null,
    @SerialName("skipped") val skipped: Long? = null,
    @SerialName("verworfen") val verworfen: Long? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("enqueued") val enqueued: Long? = null,
    @SerialName("message") val message: String? = null,
)

@Serializable
data class VerwaltungSet(
    @SerialName("dauer_minuten") val dauerMinuten: Long? = null,
    @SerialName("pending") val pending: Long? = null,
    @SerialName("queued") val queued: Long? = null,
    @SerialName("skipped") val skipped: Long? = null,
    @SerialName("verworfen") val verworfen: Long? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("enqueued") val enqueued: Long? = null,
    @SerialName("set_number") val setNumber: String,
)

@Serializable
data class VerwaltungTtl(
    @SerialName("dauer_minuten") val dauerMinuten: Long? = null,
    @SerialName("pending") val pending: Long? = null,
    @SerialName("queued") val queued: Long? = null,
    @SerialName("skipped") val skipped: Long? = null,
    @SerialName("verworfen") val verworfen: Long? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("enqueued") val enqueued: Long? = null,
    @SerialName("ttl") val ttl: JsonElement? = null,
)

@Serializable
data class VerwaltungZustand(
    @SerialName("dauer_minuten") val dauerMinuten: Long? = null,
    @SerialName("pending") val pending: Long? = null,
    @SerialName("queued") val queued: Long? = null,
    @SerialName("skipped") val skipped: Long? = null,
    @SerialName("verworfen") val verworfen: Long? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("enqueued") val enqueued: Long? = null,
    @SerialName("condition") val condition: String? = null,
)

@Serializable
data class WantedXmlErgebnis(
    @SerialName("success") val success: Boolean,
    @SerialName("vorschau") val vorschau: Boolean,
    @SerialName("gelesen") val gelesen: Long,
    @SerialName("angelegt") val angelegt: Long,
    @SerialName("aufgestockt") val aufgestockt: Long,
    @SerialName("fehler") val fehler: Long,
    @SerialName("posten") val posten: List<WantedXmlErgebnisPostenEintrag>,
    @SerialName("offen") val offen: List<WantedXmlErgebnisOffenEintrag>,
    @SerialName("fremdeArten") val fremdeArten: JsonObject? = null,
    @SerialName("ohneNummer") val ohneNummer: Long? = null,
    @SerialName("stufen") val stufen: JsonObject? = null,
    @SerialName("farbeOffen") val farbeOffen: Long? = null,
    @SerialName("standardZustand") val standardZustand: String? = null,
    @SerialName("abgebrochen") val abgebrochen: Boolean? = null,
    @SerialName("korrekturen") val korrekturen: WantedXmlErgebnisKorrekturen? = null,
    @SerialName("rebrickable") val rebrickable: WantedXmlErgebnisRebrickable? = null,
)

@Serializable
data class WantedXmlErgebnisPostenEintrag(
    @SerialName("art") val art: String,
    @SerialName("blId") val blId: String,
    @SerialName("menge") val menge: Long,
    @SerialName("ausgang") val ausgang: String,
    @SerialName("blFarbe") val blFarbe: Long? = null,
    @SerialName("rbId") val rbId: String? = null,
    @SerialName("rbFarbe") val rbFarbe: Long? = null,
    @SerialName("farbName") val farbName: String? = null,
    @SerialName("farbHex") val farbHex: String? = null,
    @SerialName("sicherheit") val sicherheit: String? = null,
    @SerialName("zustand") val zustand: String? = null,
    @SerialName("maxPreis") val maxPreis: Double? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("nameGeraten") val nameGeraten: Boolean? = null,
    @SerialName("bild") val bild: String? = null,
    @SerialName("grund") val grund: String? = null,
    @SerialName("grundCode") val grundCode: String? = null,
)

@Serializable
data class WantedXmlErgebnisOffenEintrag(
    @SerialName("art") val art: String,
    @SerialName("blId") val blId: String,
    @SerialName("blFarbe") val blFarbe: Long? = null,
)

@Serializable
data class WantedXmlErgebnisKorrekturen(
    @SerialName("angewandt") val angewandt: Long,
    @SerialName("abgewiesen") val abgewiesen: List<JsonElement?>,
)

@Serializable
data class WantedXmlErgebnisRebrickable(
    @SerialName("gefragt") val gefragt: Long,
    @SerialName("gefunden") val gefunden: Long,
    @SerialName("filterWirkungslos") val filterWirkungslos: Boolean,
    @SerialName("abgebrochen") val abgebrochen: String? = null,
)

@Serializable
data class Wiederhergestellt(
    @SerialName("success") val success: Boolean,
    @SerialName("art") val art: String,
    @SerialName("nummer") val nummer: String,
    @SerialName("user_id") val userId: Long,
)

@Serializable
data class ZweiterFaktorCodes(
    @SerialName("success") val success: Boolean,
    @SerialName("codes") val codes: List<String>? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class ZweiterFaktorEinrichtung(
    @SerialName("success") val success: Boolean,
    @SerialName("geheimnis") val geheimnis: String? = null,
    @SerialName("otpauth") val otpauth: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class ZweiterFaktorStand(
    @SerialName("success") val success: Boolean,
    @SerialName("aktiv") val aktiv: Boolean,
    @SerialName("codes_uebrig") val codesUebrig: Long,
    @SerialName("error") val error: String? = null,
)
