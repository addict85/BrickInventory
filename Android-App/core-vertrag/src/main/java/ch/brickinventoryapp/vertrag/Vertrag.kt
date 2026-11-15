// Erzeugt aus Web-App/docs/openapi.json durch Web-App/scripts/vertrag-kotlin-dtos.js.
// Nicht von Hand ändern: npm run vertrag:kotlin (im Ordner Web-App).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")
@file:OptIn(ExperimentalSerializationApi::class)

package ch.brickinventoryapp.vertrag

import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.model.fach.Laufstatus
import ch.brickinventoryapp.model.fach.TOKEN_SCOPE_APP
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.ui.theme.DesignOderNichts
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

@Serializable
data class Acquisition(
    @SerialName("id") val id: Int,
    @SerialName("quantity") val quantity: Int,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("condition") val condition: Zustand = Zustand.NEU,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("price_estimated") val priceEstimated: Boolean = false,
    @SerialName("currency") val currency: Waehrung? = null,
    @SerialName("preis_konto") val preisKonto: Double? = null,
)

@Serializable
data class AcquisitionTotals(
    @SerialName("quantity") val quantity: Int = 0,
    @SerialName("amount") val amount: Double? = null,
    @SerialName("priced_rows") val pricedRows: Int = 0,
    @SerialName("currency") val currency: String = "",
    @SerialName("ohne_kurs") val ohneKurs: Int = 0,
)

@Serializable
data class AcquisitionsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("owner_user_id") val ownerUserId: Int = 0,
    @SerialName("acquisitions") val acquisitions: List<Acquisition> = emptyList(),
    @SerialName("totals") val totals: AcquisitionTotals = AcquisitionTotals(),
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
)

@Serializable
data class AddMinifigRequest(
    @SerialName("fig_number") val figNumber: String,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("condition") val condition: Zustand? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("fig_name") @EncodeDefault(EncodeDefault.Mode.NEVER) val figName: String? = null,
    @SerialName("image_url") @EncodeDefault(EncodeDefault.Mode.NEVER) val imageUrl: String? = null,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("acquired_at") @EncodeDefault(EncodeDefault.Mode.NEVER) val acquiredAt: String? = null,
)

@Serializable
data class AddMinifigResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String? = null,
    @SerialName("fig_number") val figNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("price_from_condition") val priceFromCondition: Zustand? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class AddPartRequest(
    @SerialName("part_number") val partNumber: String,
    @SerialName("color_id") val colorId: Int = KEINE_FARBE,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("condition") val condition: Zustand? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("part_name") @EncodeDefault(EncodeDefault.Mode.NEVER) val partName: String? = null,
    @SerialName("image_url") @EncodeDefault(EncodeDefault.Mode.NEVER) val imageUrl: String? = null,
    @SerialName("category_name") @EncodeDefault(EncodeDefault.Mode.NEVER) val categoryName: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("acquired_at") @EncodeDefault(EncodeDefault.Mode.NEVER) val acquiredAt: String? = null,
)

@Serializable
data class AddPartResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String? = null,
    @SerialName("part_number") val partNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("price_from_condition") val priceFromCondition: Zustand? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class AddSetRequest(
    @SerialName("set_number") val setNumber: String,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("condition") val condition: Zustand? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("currency") @EncodeDefault(EncodeDefault.Mode.NEVER) val currency: String? = null,
    @SerialName("date") @EncodeDefault(EncodeDefault.Mode.NEVER) val date: String? = null,
)

@Serializable
data class AddSetResponse(
    @SerialName("success") val success: Boolean = true,
    @SerialName("action") val action: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("katalog_offen") val katalogOffen: Boolean = false,
    @SerialName("ergaenzung") val ergaenzung: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int = 0,
    @SerialName("is_self") val isSelf: Boolean = false,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class AndereBeendenAnfrage(
    @SerialName("zugaenge") val zugaenge: Boolean = true,
    @SerialName("password") val password: String? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class AndereBeendet(
    @SerialName("success") val success: Boolean,
    @SerialName("deleted") val deleted: Int = 0,
    @SerialName("zugaenge") val zugaenge: Int = 0,
)

@Serializable
data class AnleitungHochgeladenInstruction(
    @SerialName("url") val url: String = "",
    @SerialName("description") val description: String? = null,
    @SerialName("local_path") val localPath: String = "",
)

@Serializable
data class AnleitungenGeladen(
    @SerialName("success") val success: Boolean = false,
    @SerialName("count") val count: Int = 0,
    @SerialName("instructions") val instructions: List<Instruction> = emptyList(),
    @SerialName("auftrag_id") val auftragId: String? = null,
)

@Serializable
data class ApiLimits(
    @SerialName("rebrickable") val rebrickable: Int = 0,
    @SerialName("bricklink") val bricklink: Int = 0,
    @SerialName("brickset") val brickset: Int = 0,
)

@Serializable
data class ApiLimitsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("limits") val limits: ApiLimits = ApiLimits(),
)

@Serializable
data class AppThemeResponse(
    @SerialName("success") val success: Boolean = false,
    @Serializable(with = DesignOderNichts::class) @SerialName("theme") val theme: Design? = null,
    @Serializable(with = DesignOderNichts::class) @SerialName("vorgabe") val vorgabe: Design? = null,
    @Serializable(with = DesignOderNichts::class) @SerialName("eigenes") val eigenes: Design? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class AppToken(
    @SerialName("token_id") val tokenId: String,
    @SerialName("label") val label: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("last_used") val lastUsed: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("aktuell") val aktuell: Boolean = false,
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
    @SerialName("bildbedarf") val bildbedarf: Int,
    @SerialName("job_prozess") val jobProzess: JobProzess,
)

@Serializable
data class Auftrag(
    @SerialName("id") val id: String,
    @SerialName("art") val art: String,
    @SerialName("status") val status: String,
    @SerialName("versuche") val versuche: Int,
    @SerialName("max_versuche") val maxVersuche: Int,
    @SerialName("faellig_ab") val faelligAb: String?,
    @SerialName("frist_bis") val fristBis: String?,
    @SerialName("gestartet") val gestartet: String?,
    @SerialName("erstellt") val erstellt: String?,
    @SerialName("aktualisiert") val aktualisiert: String?,
    @SerialName("fortschritt") val fortschritt: AuftragFortschritt?,
    @SerialName("fehler") val fehler: String?,
    @SerialName("geplant") val geplant: Boolean,
    @SerialName("wartet") val wartet: Boolean = false,
    @SerialName("set_number") val setNumber: String?,
)

@Serializable
data class AuftragAenderung(
    @SerialName("success") val success: Boolean,
    @SerialName("id") val id: String,
    @SerialName("status") val status: String,
)

@Serializable
data class AuftragFortschritt(
    @SerialName("erledigt") val erledigt: Int? = null,
    @SerialName("gesamt") val gesamt: Int? = null,
    @SerialName("text") val text: String? = null,
)

@Serializable
data class AuftragPause(
    @SerialName("art") val art: String,
    @SerialName("bis") val bis: String?,
    @SerialName("grund") val grund: String?,
)

@Serializable
data class AuftragZaehler(
    @SerialName("art") val art: String,
    @SerialName("status") val status: String,
    @SerialName("anzahl") val anzahl: Int,
)

@Serializable
data class AuftragsArtLeerung(
    @SerialName("success") val success: Boolean,
    @SerialName("art") val art: String,
    @SerialName("entfernt") val entfernt: Int,
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
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("pieces") val pieces: Int? = null,
    @SerialName("theme") val theme: String? = null,
    @SerialName("minifigs") val minifigs: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("unsicher") val unsicher: Boolean = false,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class BestandEintrag(
    @SerialName("gesamt") val gesamt: Int = 0,
    @SerialName("lose") val lose: Int = 0,
)

@Serializable
data class BestandGeleert(
    @SerialName("success") val success: Boolean = false,
    @SerialName("sets") val sets: Int = 0,
    @SerialName("teile") val teile: Int = 0,
    @SerialName("figuren") val figuren: Int = 0,
    @SerialName("papierkorb") val papierkorb: List<Int> = emptyList(),
)

@Serializable
data class BestandRequest(
    @SerialName("teile") val teile: List<BestandTeil>,
)

@Serializable
data class BestandResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("bestand") val bestand: Map<String, BestandEintrag> = emptyMap(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class BestandTeil(
    @SerialName("part_number") val partNumber: String,
    @SerialName("color_id") val colorId: Int,
)

@Serializable
data class BestandteilKopf(
    @SerialName("nummer") val nummer: String,
    @SerialName("name") val name: String? = null,
    @SerialName("color_id") val colorId: Int? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("is_spare") val isSpare: Boolean = false,
    @SerialName("storage") val storage: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Int> = emptyList(),
    @SerialName("total_quantity") val totalQuantity: Int = 0,
)

@Serializable
data class BildDiagnose(
    @SerialName("success") val success: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("hinweise") val hinweise: List<String> = emptyList(),
    @SerialName("datenbank") val datenbank: BildDiagnoseDatenbank = BildDiagnoseDatenbank(),
    @SerialName("lokal") val lokal: BildDiagnoseLokal = BildDiagnoseLokal(),
    @SerialName("proxy") val proxy: BildDiagnoseProxy = BildDiagnoseProxy(),
    @SerialName("merker") val merker: BildDiagnoseMerker? = null,
)

@Serializable
data class BildDiagnoseDatenbank(
    @SerialName("anzahl_konten") val anzahlKonten: Int = 0,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("katalog_bild") val katalogBild: String? = null,
)

@Serializable
data class BildDiagnoseLokal(
    @SerialName("original") val original: BildDiagnoseLokalOriginal = BildDiagnoseLokalOriginal(),
    @SerialName("vorschau") val vorschau: BildDiagnoseLokalVorschau = BildDiagnoseLokalVorschau(),
)

@Serializable
data class BildDiagnoseLokalOriginal(
    @SerialName("vorhanden") val vorhanden: Boolean = false,
    @SerialName("bytes") val bytes: Int = 0,
    @SerialName("geaendert") val geaendert: String? = null,
)

@Serializable
data class BildDiagnoseLokalVorschau(
    @SerialName("vorhanden") val vorhanden: Boolean = false,
    @SerialName("bytes") val bytes: Int = 0,
    @SerialName("geaendert") val geaendert: String? = null,
)

@Serializable
data class BildDiagnoseMerker(
    @SerialName("seit") val seit: String? = null,
    @SerialName("grund") val grund: String? = null,
)

@Serializable
data class BildDiagnoseProxy(
    @SerialName("gecacht") val gecacht: Boolean = false,
    @SerialName("adresse") val adresse: String? = null,
)

@Serializable
data class BildMerkerVergessen(
    @SerialName("success") val success: Boolean = false,
    @SerialName("entfernt") val entfernt: Int = 0,
    @SerialName("hinweis") val hinweis: String = "",
)

@Serializable
data class BlFarbTabelle(
    @SerialName("success") val success: Boolean = false,
    @SerialName("source") val source: String = "",
    @SerialName("map") val map: JsonObject = JsonObject(emptyMap()),
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
)

@Serializable
data class BrickColor(
    @SerialName("id") val id: Int,
    @SerialName("name") val name: String,
    @SerialName("hex") val hex: String? = null,
)

@Serializable
data class BrickColorsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("colors") val colors: List<BrickColor> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class BrickLinkRef(
    @SerialName("type") val type: String = "SET",
    @SerialName("number") val number: String = "",
    @SerialName("url") val url: String? = null,
    @SerialName("exact") val exact: Boolean = true,
    @SerialName("resolved") val resolved: Boolean = false,
)

@Serializable
data class BricklinkVerweise(
    @SerialName("success") val success: Boolean = false,
    @SerialName("links") val links: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class BricksetQueueEntry(
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("attempts") val attempts: Int = 0,
    @SerialName("retry_after") val retryAfter: String? = null,
    @SerialName("last_error") val lastError: String? = null,
)

@Serializable
data class BricksetQueueResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("count") val count: Int = 0,
    @SerialName("entries") val entries: List<BricksetQueueEntry> = emptyList(),
)

@Serializable
data class CacheStatsResponse(
    @SerialName("db_pool") val dbPool: JsonObject = JsonObject(emptyMap()),
    @SerialName("success") val success: Boolean,
    @SerialName("prices") val prices: Int = 0,
    @SerialName("subsets") val subsets: Int = 0,
    @SerialName("catalog") val catalog: Int = 0,
    @SerialName("price_stale") val priceStale: Int = 0,
    @SerialName("rate_limits") val rateLimits: RateLimits? = null,
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
)

@Serializable
data class CacheTtlResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("ttl") val ttl: String = "24",
)

@Serializable
data class CatalogMetaResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("themes") val themes: List<CatalogTheme> = emptyList(),
    @SerialName("year_min") val yearMin: Int? = null,
    @SerialName("year_max") val yearMax: Int? = null,
    @SerialName("year_counts") val yearCounts: List<CatalogYearCount> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class CatalogSetDetail(
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("theme_id") val themeId: Int? = null,
    @SerialName("theme_name") val themeName: String? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("minifigs") val minifigs: Int = 0,
    @SerialName("owned") val owned: Boolean = false,
    @SerialName("owned_quantity") val ownedQuantity: Int = 0,
    @SerialName("bricklink") val bricklink: BrickLinkRef? = null,
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null,
)

@Serializable
data class CatalogSetDetailResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set") val set: CatalogSetDetail? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class CatalogSetItem(
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("theme_id") val themeId: Int? = null,
    @SerialName("theme_name") val themeName: String? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("owned") val owned: Boolean = false,
    @SerialName("owned_quantity") val ownedQuantity: Int = 0,
)

@Serializable
data class CatalogSetsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("pages") val pages: Int = 0,
    @SerialName("sets") val sets: List<CatalogSetItem> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class CatalogTheme(
    @SerialName("id") val id: Int = 0,
    @SerialName("name") val name: String = "",
    @SerialName("set_count") val setCount: Int = 0,
)

@Serializable
data class CatalogYearCount(
    @SerialName("year") val year: Int = 0,
    @SerialName("n") val n: Int = 0,
)

@Serializable
data class CatalogYearVerteilungResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("years") val years: List<JahrAnzahl> = emptyList(),
)

@Serializable
data class ChartPoint(
    @SerialName("x_label") val xLabel: String = "",
    @SerialName("value") val value: Double = 0.0,
    @SerialName("y_frac") val yFrac: Double = 0.0,
)

@Serializable
data class ChartYAxis(
    @SerialName("label") val label: String = "",
    @SerialName("value") val value: Double = 0.0,
    @SerialName("frac") val frac: Double = 0.0,
)

@Serializable
data class ConditionValuation(
    @SerialName("market_price") val marketPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("pnl_pct") val pnlPctText: String? = null,
    @SerialName("pnl_prozent") val pnlPct: Double? = null,
)

@Serializable
data class CsvImportErgebnis(
    @SerialName("results") val results: List<CsvImportZeile> = emptyList(),
    @SerialName("waehrung_hinweis") val waehrungHinweis: String? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("skipped") val skipped: Int = 0,
    @SerialName("skipped_hint") val skippedHint: String = "",
    @SerialName("total") val total: Int = 0,
    @SerialName("added") val added: Int = 0,
    @SerialName("imported") val imported: Int = 0,
    @SerialName("updated") val updated: Int = 0,
    @SerialName("errors") val errors: Int = 0,
    @SerialName("error") val error: String? = null,
    @SerialName("gestartet") val gestartet: Boolean = false,
    @SerialName("vorhanden") val vorhanden: Int = 0,
    @SerialName("vorhanden_nummern") val vorhandenNummern: List<String> = emptyList(),
)

@Serializable
data class CsvImportStatus(
    @SerialName("code") val code: String? = null,
    @SerialName("results") val results: List<CsvImportStatusResultsEintrag> = emptyList(),
    @SerialName("success") val success: Boolean = false,
    @SerialName("status") val status: Laufstatus? = null,
    @SerialName("total") val total: Int? = null,
    @SerialName("done") val done: Int? = null,
    @SerialName("current") val current: String? = null,
    @SerialName("ok") val ok: Int? = null,
    @SerialName("warn") val warn: Int? = null,
    @SerialName("err") val err: Int? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("beendet_am") val beendetAm: String = "",
)

@Serializable
data class CsvImportStatusResultsEintrag(
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("zeile") val zeile: Int = 0,
    @SerialName("success") val success: Boolean = false,
    @SerialName("action") val action: String = "",
    @SerialName("isWarning") val isWarning: Boolean = false,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String = "",
    @SerialName("menge") val menge: Int = 0,
    @SerialName("katalog_offen") val katalogOffen: Boolean = false,
    @SerialName("part_number") val partNumber: String = "",
    @SerialName("fig_number") val figNumber: String = "",
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("condition") val condition: String = "",
    @SerialName("vars") val vars: JsonObject = JsonObject(emptyMap()),
    @SerialName("waehrung_angepasst") val waehrungAngepasst: Boolean = false,
    @SerialName("waehrung_datei") val waehrungDatei: String = "",
    @SerialName("waehrung_konto") val waehrungKonto: String = "",
)

@Serializable
data class CsvImportZeile(
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("zeile") val zeile: Int = 0,
    @SerialName("success") val success: Boolean = false,
    @SerialName("action") val action: String = "",
    @SerialName("isWarning") val isWarning: Boolean = false,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String = "",
    @SerialName("menge") val menge: Int = 0,
    @SerialName("katalog_offen") val katalogOffen: Boolean = false,
    @SerialName("part_number") val partNumber: String = "",
    @SerialName("fig_number") val figNumber: String = "",
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("condition") val condition: String = "",
    @SerialName("vars") val vars: JsonObject = JsonObject(emptyMap()),
    @SerialName("waehrung_angepasst") val waehrungAngepasst: Boolean = false,
    @SerialName("waehrung_datei") val waehrungDatei: String = "",
    @SerialName("waehrung_konto") val waehrungKonto: String = "",
)

@Serializable
data class CurrentByCondition(
    @SerialName("N") val new: CurrentPrice? = null,
    @SerialName("U") val used: CurrentPrice? = null,
)

@Serializable
data class CurrentPrice(
    @SerialName("condition") val condition: Zustand = Zustand.NEU,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("fetched_at") val fetchedAt: String? = null,
)

@Serializable
data class DashboardStats(
    @SerialName("currency") val currency: String? = null,
    @SerialName("default_condition") val defaultCondition: String? = null,
    @SerialName("user_default_condition") val userDefaultCondition: String? = null,
    @SerialName("total_sets") val totalSets: Int,
    @SerialName("total_quantity") val totalQuantity: Int,
    @SerialName("total_pieces") val totalPieces: Int,
    @SerialName("total_instructions") val totalInstructions: Int,
    @SerialName("total_parts") val totalParts: Int,
    @SerialName("set_parts") val setParts: Int? = null,
    @SerialName("manual_parts") val manualParts: Int? = null,
    @SerialName("total_minifigs") val totalMinifigs: Int,
)

@Serializable
data class DefaultConditionResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("condition") val condition: Zustand = Zustand.NEU,
)

@Serializable
data class DeleteWithQuantityResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("new_quantity") val newQuantity: Int = 0,
)

@Serializable
class Diagnose

@Serializable
data class Einrichtung(
    @SerialName("success") val success: Boolean = false,
    @SerialName("offen") val offen: Boolean = false,
    @SerialName("passwort_aendern") val passwortAendern: Boolean = false,
    @SerialName("quellen") val quellen: EinrichtungQuellen = EinrichtungQuellen(),
)

@Serializable
data class EinrichtungQuellen(
    @SerialName("rebrickable") val rebrickable: Boolean = false,
    @SerialName("bricklink") val bricklink: Boolean = false,
    @SerialName("brickset") val brickset: Boolean = false,
)

@Serializable
data class EinrichtungStand(
    @SerialName("success") val success: Boolean = false,
    @SerialName("erledigt") val erledigt: Boolean = false,
    @SerialName("konfiguriert") val konfiguriert: Boolean = false,
    @SerialName("schritte") val schritte: List<EinrichtungStandSchritteEintrag> = emptyList(),
    @SerialName("ca") val ca: EinrichtungStandCa = EinrichtungStandCa(),
    @SerialName("basis_url") val basisUrl: String? = null,
    @SerialName("https") val https: Boolean = false,
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
)

@Serializable
data class EinrichtungStandCa(
    @SerialName("vorhanden") val vorhanden: Boolean = false,
    @SerialName("fp_hex") val fpHex: String = "",
    @SerialName("zert_sha256") val zertSha256: String = "",
    @SerialName("gueltig_bis") val gueltigBis: String = "",
    @SerialName("download") val download: String = "",
)

@Serializable
data class EinrichtungStandSchritteEintrag(
    @SerialName("id") val id: String = "",
    @SerialName("ok") val ok: Boolean = false,
    @SerialName("pflicht") val pflicht: Boolean = false,
)

@Serializable
data class EmailVorschau(
    @SerialName("success") val success: Boolean = false,
    @SerialName("username") val username: String = "",
)

@Serializable
data class Endpunkte(
    @SerialName("auth") val auth: JsonObject = JsonObject(emptyMap()),
    @SerialName("api") val api: String = "",
    @SerialName("version") val version: String = "",
    @SerialName("endpoints") val endpoints: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class Erledigt(
    @SerialName("success") val success: Boolean = false,
)

@Serializable
data class Fehler(
    @SerialName("success") val success: Boolean = false,
    @SerialName("error") val error: String = "",
    @SerialName("code") val code: String = "",
)

@Serializable
data class FigValuationItem(
    @SerialName("ausstehend") val ausstehend: Boolean = false,
    @SerialName("from_cache") val fromCache: Boolean = false,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("storage_id") val storageId: Int? = null,
    @SerialName("acq_count") val acqCount: Int? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    @SerialName("id") val id: Int? = null,
    @SerialName("fig_number") val figNumber: String = "",
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("quantity") val quantity: Int = 1,
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
    @SerialName("total_value") val totalValue: String = "",
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("condition") val condition: Zustand? = null,
    @SerialName("conditions") val conditions: List<Zustand> = emptyList(),
    @SerialName("user_id") val userId: Int? = null,
    @SerialName("owners") val owners: List<KontoName> = emptyList(),
    @SerialName("acquisitions") val acquisitions: List<ValuationAcquisition> = emptyList(),
    @SerialName("storage") val storage: String? = null,
)

@Serializable
data class FigsValuationResponse(
    @SerialName("kaufpreise_umgerechnet") val kaufpreiseUmgerechnet: Int? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("currency") val currency: Waehrung = Waehrung.EUR,
    @SerialName("figs") val figs: List<FigValuationItem> = emptyList(),
    @SerialName("total_value") val totalValue: String,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("preise_ausstehend") val preiseAusstehend: Int = 0,
    @SerialName("kaufpreise_fremde_waehrung") val kaufpreiseFremdeWaehrung: Int = 0,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class FigurTeile(
    @SerialName("success") val success: Boolean = false,
    @SerialName("source") val source: String = "",
    @SerialName("parts") val parts: List<JsonObject> = emptyList(),
)

@Serializable
data class ForgotPasswordRequest(
    @SerialName("email") val email: String,
)

@Serializable
data class ForgotPasswordResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("message") val message: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class GelesenerGutschein(
    @SerialName("number") val number: String? = null,
    @SerialName("pin") val pin: String? = null,
    @SerialName("amount") val amount: Double? = null,
    @SerialName("currency") val currency: Waehrung? = null,
)

@Serializable
data class Geloescht(
    @SerialName("success") val success: Boolean = false,
    @SerialName("deleted") val deleted: Int = 0,
)

@Serializable
data class GenericAdminResponse(
    @SerialName("dauer_minuten") val dauerMinuten: Int? = null,
    @SerialName("pending") val pending: Int? = null,
    @SerialName("queued") val queued: Int? = null,
    @SerialName("skipped") val skipped: Int? = null,
    @SerialName("verworfen") val verworfen: Int? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("enqueued") val enqueued: Int = 0,
    @SerialName("theme") val theme: String = "",
    @SerialName("started") val started: Boolean = false,
    @SerialName("message") val message: String = "",
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("ttl") val ttl: JsonElement = JsonNull,
    @SerialName("condition") val condition: String? = null,
)

@Serializable
data class GenericResponse(
    @SerialName("new_quantity") val newQuantity: Int? = null,
    @SerialName("from_user_id") val fromUserId: Int? = null,
    @SerialName("to_user_id") val toUserId: Int? = null,
    @SerialName("merged") val merged: Boolean = false,
    @SerialName("unchanged") val unchanged: Boolean = false,
    @SerialName("acquisitions") val acquisitions: Int? = null,
    @SerialName("instructions") val instructions: Int? = null,
    @SerialName("papierkorb") val papierkorb: JsonElement? = null,
    @SerialName("removed") val removed: Int? = null,
    @SerialName("linked_to") val linkedTo: KontoName? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("set") val set: SetAggregate? = null,
    @SerialName("parts") val parts: Int? = null,
    @SerialName("minifigs") val minifigs: Int? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean = false,
    @SerialName("quantity") val quantity: Int? = null,
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
    @SerialName("instruction") val instruction: AnleitungHochgeladenInstruction = AnleitungHochgeladenInstruction(),
    @SerialName("updated") val updated: Int = 0,
    @SerialName("entfallen") val entfallen: List<MengeGeaendertEntfallenEintrag> = emptyList(),
    @SerialName("geloescht") val geloescht: Int = 0,
)

@Serializable
data class GeraeteSchluesselAnfrage(
    @SerialName("oeffentlich") @EncodeDefault(EncodeDefault.Mode.NEVER) val oeffentlich: String? = null,
    @SerialName("kette") val kette: List<String>,
)

@Serializable
data class Gesundheit(
    @SerialName("status") val status: String = "",
    @SerialName("startup") val startup: StartupStatus = StartupStatus(),
    @SerialName("db_pool") val dbPool: JsonObject = JsonObject(emptyMap()),
    @SerialName("uptime_seconds") val uptimeSeconds: Int = 0,
)

@Serializable
data class GetrenntesKonto(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String = "",
    @SerialName("via") val via: String? = null,
)

@Serializable
data class GuthabenAntwort(
    @SerialName("success") val success: Boolean = false,
    @SerialName("voucher") val voucher: Gutschein? = null,
    @SerialName("angezeigt") val angezeigt: String? = null,
    @SerialName("waehrung_geaendert") val waehrungGeaendert: Boolean = false,
    @SerialName("grund") val grund: String? = null,
    @SerialName("wartenSek") val wartenSek: Int? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String? = null,
)

@Serializable
data class Gutschein(
    @SerialName("id") val id: Int = 0,
    @SerialName("number") val number: String = "",
    @SerialName("pin") val pin: String? = null,
    @SerialName("amount") val amount: Double = 0.0,
    @SerialName("currency") val currency: Waehrung = Waehrung.CHF,
    @SerialName("hat_pdf") val hatPdf: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("guthaben_geprueft_am") val guthabenGeprueftAm: String? = null,
)

@Serializable
data class GutscheinAntwort(
    @SerialName("success") val success: Boolean = false,
    @SerialName("voucher") val voucher: Gutschein? = null,
    @SerialName("mehrere") val mehrere: GutscheinStapel? = null,
    @SerialName("gelesen") val gelesen: GelesenerGutschein? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String? = null,
)

@Serializable
data class GutscheinKlartext(
    @SerialName("success") val success: Boolean = false,
    @SerialName("id") val id: Int = 0,
    @SerialName("number") val number: String = "",
    @SerialName("pin") val pin: String? = null,
)

@Serializable
data class GutscheinListe(
    @SerialName("success") val success: Boolean = true,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("vouchers") val vouchers: List<Gutschein> = emptyList(),
)

@Serializable
data class GutscheinPdfFreigabe(
    @SerialName("success") val success: Boolean = false,
    @SerialName("ticket") val ticket: String = "",
    @SerialName("gueltig_sek") val gueltigSek: Int = 0,
)

@Serializable
data class GutscheinRequest(
    @SerialName("number") val number: String,
    @SerialName("pin") val pin: String? = null,
    @SerialName("amount") val amount: Double,
    @SerialName("currency") val currency: Waehrung = Waehrung.CHF,
)

@Serializable
data class GutscheinStapel(
    @SerialName("results") val results: List<JsonElement?> = emptyList(),
    @SerialName("added") val added: Int = 0,
    @SerialName("updated") val updated: Int = 0,
    @SerialName("errors") val errors: Int = 0,
    @SerialName("total") val total: Int = 0,
)

@Serializable
data class HouseholdInviteCheckResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("inviter") val inviter: HouseholdInviteCheckResponseInviter = HouseholdInviteCheckResponseInviter(),
)

@Serializable
data class HouseholdInviteCheckResponseInviter(
    @SerialName("id") val id: Int = 0,
    @SerialName("username") val username: String = "",
)

@Serializable
data class HouseholdInviteResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("code") val code: String? = null,
    @SerialName("expires_in") val expiresIn: Int? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class HouseholdMember(
    @SerialName("tiefe") val tiefe: Int? = null,
    @SerialName("id") val id: Int = 0,
    @SerialName("username") val username: String = "",
    @SerialName("is_self") val isSelf: Boolean = false,
)

@Serializable
data class HouseholdMembersResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("members") val members: List<HouseholdMember> = emptyList(),
)

@Serializable
data class HouseholdStatusResponse(
    @SerialName("blickfeld") val blickfeld: List<HouseholdMember> = emptyList(),
    @SerialName("success") val success: Boolean = false,
    @SerialName("is_main") val isMain: Boolean = false,
    @SerialName("is_sub") val isSub: Boolean = false,
    @SerialName("currency") val currency: Waehrung = Waehrung.KEINE,
    @SerialName("linked_to") val linkedTo: KontoName? = null,
    @SerialName("parents") val parents: List<KontoName> = emptyList(),
    @SerialName("sub_accounts") val subAccounts: List<HouseholdMember> = emptyList(),
    @SerialName("open_invites") val openInvites: Int = 0,
    @SerialName("former_links") val formerLinks: List<GetrenntesKonto> = emptyList(),
    @SerialName("error") val error: String? = null,
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
)

@Serializable
data class Instruction(
    @SerialName("downloaded_at") val downloadedAt: String? = null,
    @SerialName("fetched_at") val fetchedAt: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("user_id") val userId: Int? = null,
    @SerialName("id") val id: Int? = null,
    @SerialName("url") val url: String,
    @SerialName("description") val description: String? = null,
    @SerialName("local_path") val localPath: String? = null,
    @SerialName("is_manual") val isManual: Boolean = false,
)

@Serializable
data class JahrAnzahl(
    @SerialName("year") val year: Int? = null,
    @SerialName("n") val n: Int = 0,
)

@Serializable
data class JobProzess(
    @SerialName("lebenszeichen") val lebenszeichen: String?,
    @SerialName("alter_sekunden") val alterSekunden: Int?,
    @SerialName("laeuft") val laeuft: Boolean,
)

@Serializable
data class JobSchedule(
    @SerialName("type") val type: String = "daily",
    @SerialName("time") val time: String? = null,
    @SerialName("minutes") val minutes: Int? = null,
)

@Serializable
data class JobStatus(
    @SerialName("lastRun") val lastRun: JsonElement? = null,
    @SerialName("canRedownload") val canRedownload: Boolean = false,
    @SerialName("queue") val queue: Int? = null,
    @SerialName("queueLastRun") val queueLastRun: JsonElement? = null,
    @SerialName("label") val label: String = "",
    @SerialName("status") val status: Laufstatus = Laufstatus.RUHT,
    @SerialName("progress") val progress: Int = 0,
    @SerialName("total") val total: Int = 0,
    @SerialName("sub") val sub: String? = null,
    @SerialName("sub_teile") val subTeile: List<JobStatusSubTeileEintrag> = emptyList(),
)

@Serializable
data class JobStatusSubTeileEintrag(
    @SerialName("code") val code: String = "",
    @SerialName("werte") val werte: JsonObject = JsonObject(emptyMap()),
    @SerialName("vor") val vor: String = "",
)

@Serializable
data class JobsResponse(
    @SerialName("db") val db: JsonObject = JsonObject(emptyMap()),
    @SerialName("success") val success: Boolean,
    @SerialName("jobs") val jobs: Map<String, JobStatus> = emptyMap(),
    @SerialName("schedules") val schedules: Map<String, JobSchedule> = emptyMap(),
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
    @SerialName("proxy_hinweis") val proxyHinweis: JobsResponseProxyHinweis? = null,
)

@Serializable
data class JobsResponseProxyHinweis(
    @SerialName("art") val art: String = "",
    @SerialName("vars") val vars: JobsResponseProxyHinweisVars = JobsResponseProxyHinweisVars(),
)

@Serializable
data class JobsResponseProxyHinweisVars(
    @SerialName("ip") val ip: String = "",
    @SerialName("minuten") val minuten: Int = 0,
    @SerialName("anzahl") val anzahl: Int = 0,
)

@Serializable
data class KonfigExport(
    @SerialName("version") val version: String = "",
    @SerialName("exported_at") val exportedAt: String = "",
    @SerialName("exported_by") val exportedBy: String? = null,
    @SerialName("global") val global: JsonObject = JsonObject(emptyMap()),
    @SerialName("user_settings") val userSettings: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class KontenListe(
    @SerialName("success") val success: Boolean = false,
    @SerialName("users") val users: List<KontoInListe> = emptyList(),
)

@Serializable
data class KontoAktiv(
    @SerialName("success") val success: Boolean = false,
    @SerialName("is_active") val isActive: Boolean = false,
)

@Serializable
data class KontoInListe(
    @SerialName("id") val id: Int = 0,
    @SerialName("username") val username: String = "",
    @SerialName("is_admin") val isAdmin: Boolean = false,
    @SerialName("is_active") val isActive: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("zweiter_faktor") val zweiterFaktor: Boolean = false,
    @SerialName("wartet_auf_bestaetigung") val wartetAufBestaetigung: Boolean = false,
)

@Serializable
data class KontoName(
    @SerialName("id") val id: Int = 0,
    @SerialName("username") val username: String = "",
)

@Serializable
data class Lagerort(
    @SerialName("figuren") val figuren: Int? = null,
    @SerialName("ort") val ort: String,
    @SerialName("sets") val sets: Int = 0,
    @SerialName("teile") val teile: Int = 0,
)

@Serializable
data class LagerortEintrag(
    @SerialName("id") val id: Int = 0,
    @SerialName("user_id") val userId: Int = 0,
    @SerialName("name") val name: String = "",
)

@Serializable
data class LagerortEintragResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("ort") val ort: LagerortEintrag? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class LagerortNameRequest(
    @SerialName("name") val name: String,
    @SerialName("owner") @EncodeDefault(EncodeDefault.Mode.NEVER) val owner: JsonElement? = null,
)

@Serializable
data class LagerortRequest(
    @SerialName("storage") val storage: String,
)

@Serializable
data class LagerortResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("storage") val storage: String? = null,
    @SerialName("changed") val changed: Int = 0,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class LagerortVorgabeRequest(
    @SerialName("id") val id: Int? = null,
)

@Serializable
data class LagerortVorgabeResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("vorgabe") val vorgabe: LagerortEintrag? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class LagerortVorratResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("orte") val orte: List<LagerortEintrag> = emptyList(),
    @SerialName("vorgabe") val vorgabe: LagerortEintrag? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class LagerorteResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("orte") val orte: List<Lagerort> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Lebenszeichen(
    @SerialName("status") val status: String = "",
)

@Serializable
data class LoginRequest(
    @SerialName("username") val username: String,
    @SerialName("password") val password: String,
    @SerialName("code") @EncodeDefault(EncodeDefault.Mode.NEVER) val code: String? = null,
    @SerialName("ohne_token") @EncodeDefault(EncodeDefault.Mode.NEVER) val ohneToken: Boolean? = null,
    @SerialName("label") val label: String = "Android App",
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("scope") val scope: String = TOKEN_SCOPE_APP,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class LoginResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("user") val user: User? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("zweiter_faktor") val zweiterFaktor: Boolean = false,
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
    @SerialName("keks_fehlt") val keksFehlt: Boolean = false,
)

@Serializable
data class ManualFigsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("figs") val figs: List<FigValuationItem> = emptyList(),
    @SerialName("error") val error: String? = null,
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
)

@Serializable
data class ManualPartsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("parts") val parts: List<PartValuationItem> = emptyList(),
    @SerialName("error") val error: String? = null,
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
)

@Serializable
data class MeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("loggedIn") val loggedIn: Boolean = false,
    @SerialName("user") val user: User? = null,
    @SerialName("token_expires") val tokenExpires: String? = null,
    @SerialName("token_last_used") val tokenLastUsed: String? = null,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
)

@Serializable
data class MengeGeaendertEntfallenEintrag(
    @SerialName("id") val id: Int = 0,
    @SerialName("quantity") val quantity: Int = 0,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("currency") val currency: String? = null,
    @SerialName("price_estimated") val priceEstimated: Boolean = false,
    @SerialName("condition") val condition: String = "",
    @SerialName("date") val date: String? = null,
)

@Serializable
data class MerklisteResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("merkposten") val merkposten: List<Merkposten> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Merkposten(
    @SerialName("theme_id") val themeId: Int? = null,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("condition") val condition: Zustand = Zustand.NEU,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("user_id") val userId: Int = 0,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("marktpreis") val marktpreis: Double? = null,
    @SerialName("waehrung") val waehrung: Waehrung = Waehrung.EUR,
    @SerialName("owned") val owned: Boolean = false,
    @SerialName("alarm") val alarm: MerkpostenAlarm? = null,
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null,
)

@Serializable
data class MerkpostenAlarm(
    @SerialName("richtung") val richtung: Alarmrichtung = Alarmrichtung.UNTER,
    @SerialName("schwelle") val schwelle: Double = 0.0,
    @SerialName("ausgeloest") val ausgeloest: Boolean = false,
)

@Serializable
data class MerkpostenAntwort(
    @SerialName("success") val success: Boolean = false,
    @SerialName("war_neu") val warNeu: Boolean = false,
    @SerialName("merkposten") val merkposten: Merkposten? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class MerkpostenInhaberAntwort(
    @SerialName("success") val success: Boolean = false,
    @SerialName("verschoben") val verschoben: Boolean = false,
    @SerialName("zusammengefuehrt") val zusammengefuehrt: Boolean = false,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class MerkpostenInhaberRequest(
    @SerialName("owner_user_id") val ownerUserId: Int,
    @SerialName("neuer_inhaber") val neuerInhaber: Int,
)

@Serializable
data class MerkpostenPreiseResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("currency") val currency: Waehrung = Waehrung.KEINE,
    @SerialName("current") val current: CurrentByCondition = CurrentByCondition(),
    @SerialName("error") val error: String? = null,
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
)

@Serializable
data class MerkpostenRequest(
    @SerialName("set_number") val setNumber: String,
    @SerialName("condition") val condition: Zustand = Zustand.NEU,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
)

@Serializable
data class MerkpostenUebernahmeRequest(
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("condition") val condition: Zustand? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("storage") val storage: String? = null,
)

@Serializable
data class MerkpostenUebernahmeResponse(
    @SerialName("katalog_offen") val katalogOffen: Boolean = false,
    @SerialName("name") val name: String? = null,
    @SerialName("success") val success: Boolean = false,
    @SerialName("action") val action: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Minifig(
    @SerialName("id") val id: Int? = null,
    @SerialName("in_sets") val inSets: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Int> = emptyList(),
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("fig_number") val figNumber: String,
    @SerialName("condition") val condition: Zustand? = null,
    @SerialName("conditions") val conditions: List<Zustand> = emptyList(),
    @SerialName("owners") val owners: List<KontoName> = emptyList(),
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("total_quantity") val totalQuantity: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("source") val source: String = "set",
    @SerialName("set_added_at") val setAddedAt: String? = null,
)

@Serializable
data class MinifigStats(
    @SerialName("unique_figs") val uniqueFigs: Int? = null,
    @SerialName("types") val types: Int = 0,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
    @SerialName("manual") val manual: Int = 0,
)

@Serializable
data class MinifigStatsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("stats") val stats: MinifigStats = MinifigStats(),
)

@Serializable
data class MinifigsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("source") val source: String = "",
    @SerialName("figs") val figs: List<Minifig> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class MoveSetRequest(
    @SerialName("from_user_id") val fromUserId: Int? = null,
    @SerialName("to_user_id") val toUserId: Int,
    @SerialName("acquisition_ids") val acquisitionIds: List<Int>? = null,
)

@Serializable
data class MoveSetResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("quantity") val quantity: Int = 0,
    @SerialName("acquisitions") val acquisitions: Int = 0,
    @SerialName("merged") val merged: Boolean = false,
    @SerialName("parts") val parts: Int = 0,
    @SerialName("minifigs") val minifigs: Int = 0,
    @SerialName("instructions") val instructions: Int = 0,
    @SerialName("source_emptied") val sourceEmptied: Boolean = false,
    @SerialName("from_user_id") val fromUserId: Int = 0,
    @SerialName("to_user_id") val toUserId: Int = 0,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Papierkorb(
    @SerialName("success") val success: Boolean = false,
    @SerialName("eintraege") val eintraege: List<PapierkorbEintrag> = emptyList(),
)

@Serializable
data class PapierkorbEintrag(
    @SerialName("id") val id: Int = 0,
    @SerialName("art") val art: String = "",
    @SerialName("nummer") val nummer: String = "",
    @SerialName("farbe_id") val farbeId: Int? = null,
    @SerialName("bezeichnung") val bezeichnung: String? = null,
    @SerialName("anzahl") val anzahl: Int = 0,
    @SerialName("user_id") val userId: Int = 0,
    @SerialName("geloescht_am") val geloeschtAm: String = "",
    @SerialName("endgueltig_am") val endgueltigAm: String = "",
)

@Serializable
data class PapierkorbGeleert(
    @SerialName("success") val success: Boolean = false,
    @SerialName("entfernt") val entfernt: Int = 0,
)

@Serializable
data class Part(
    @SerialName("condition") val condition: String? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Int = KEINE_FARBE,
    @SerialName("bl_color_id") val blColorId: Int? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
    @SerialName("in_sets") val inSets: String? = null,
    @SerialName("is_spare") val isSpare: Boolean = false,
)

@Serializable
data class PartValuationItem(
    @SerialName("ausstehend") val ausstehend: Boolean = false,
    @SerialName("from_cache") val fromCache: Boolean = false,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("acq_count") val acqCount: Int? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("id") val id: Int? = null,
    @SerialName("part_number") val partNumber: String = "",
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Int = KEINE_FARBE,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("quantity") val quantity: Int = 1,
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
    @SerialName("total_value") val totalValue: String = "",
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("condition") val condition: Zustand? = null,
    @SerialName("conditions") val conditions: List<Zustand> = emptyList(),
    @SerialName("user_id") val userId: Int? = null,
    @SerialName("owners") val owners: List<KontoName> = emptyList(),
    @SerialName("acquisitions") val acquisitions: List<ValuationAcquisition> = emptyList(),
    @SerialName("storage") val storage: String? = null,
)

@Serializable
data class PartsCategoriesResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("categories") val categories: List<PartsCategory> = emptyList(),
)

@Serializable
data class PartsCategory(
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("label") val label: String? = null,
    @SerialName("unique_parts") val uniqueParts: Int = 0,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
)

@Serializable
data class PartsFilterColor(
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("unique_parts") val uniqueParts: Int = 0,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
)

@Serializable
data class PartsFilterColorsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("colors") val colors: List<PartsFilterColor> = emptyList(),
)

@Serializable
data class PartsResponse(
    @SerialName("source") val source: String? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 1,
    @SerialName("page_size") val pageSize: Int = 100,
    @SerialName("parts") val parts: List<Part> = emptyList(),
    @SerialName("error") val error: String? = null,
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
)

@Serializable
data class PartsStats(
    @SerialName("unique_parts") val uniqueParts: Int = 0,
    @SerialName("unique_colors") val uniqueColors: Int = 0,
    @SerialName("total_parts") val totalParts: Int = 0,
    @SerialName("manual_parts") val manualParts: Int? = null,
)

@Serializable
data class PartsStatsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("stats") val stats: PartsStats? = null,
)

@Serializable
data class PartsValuationResponse(
    @SerialName("kaufpreise_umgerechnet") val kaufpreiseUmgerechnet: Int? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("currency") val currency: Waehrung = Waehrung.EUR,
    @SerialName("parts") val parts: List<PartValuationItem> = emptyList(),
    @SerialName("total_value") val totalValue: String,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("preise_ausstehend") val preiseAusstehend: Int = 0,
    @SerialName("kaufpreise_fremde_waehrung") val kaufpreiseFremdeWaehrung: Int = 0,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Passkey(
    @SerialName("id") val id: Int = 0,
    @SerialName("name") val name: String? = null,
    @SerialName("transports") val transports: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("last_used") val lastUsed: String? = null,
)

@Serializable
data class PasskeyAngelegt(
    @SerialName("success") val success: Boolean = false,
    @SerialName("passkey") val passkey: PasskeyAngelegtPasskey = PasskeyAngelegtPasskey(),
)

@Serializable
data class PasskeyAngelegtPasskey(
    @SerialName("id") val id: Int = 0,
    @SerialName("name") val name: String = "",
)

@Serializable
data class PasskeyAnmeldungAnfrage(
    @SerialName("antwort") @EncodeDefault(EncodeDefault.Mode.NEVER) val antwort: JsonObject? = null,
    @SerialName("mit_token") val mitToken: Boolean = true,
    @SerialName("label") val label: String = "Android App",
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("scope") val scope: String = TOKEN_SCOPE_APP,
)

@Serializable
data class PasskeyListe(
    @SerialName("success") val success: Boolean = false,
    @SerialName("verfuegbar") val verfuegbar: Boolean = false,
    @SerialName("passkeys") val passkeys: List<Passkey> = emptyList(),
)

@Serializable
data class PasskeyOptionen(
    @SerialName("success") val success: Boolean = false,
    @SerialName("optionen") val optionen: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class PasskeyOptionenAnfrage(
    @SerialName("zweck") val zweck: String,
)

@Serializable
data class PasswortAenderung(
    @SerialName("newPassword") val newPassword: String,
    @SerialName("passkeys_widerrufen") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkeysWiderrufen: Boolean? = null,
    @SerialName("current") val current: String,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class PasswortGesetzt(
    @SerialName("success") val success: Boolean = false,
    @SerialName("wirksam_ab") val wirksamAb: String = "",
)

@Serializable
data class PdfAuftragAnfrage(
    @SerialName("sets") val sets: List<PdfAuftragSet> = emptyList(),
    @SerialName("parts") val parts: List<PdfAuftragTeil> = emptyList(),
)

@Serializable
data class PdfAuftragAntwort(
    @SerialName("success") val success: Boolean = false,
    @SerialName("jobId") val jobId: String = "",
)

@Serializable
data class PdfAuftragSet(
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
)

@Serializable
data class PdfAuftragStand(
    @SerialName("success") val success: Boolean = false,
    @SerialName("status") val status: Laufstatus = Laufstatus.UNBEKANNT,
    @SerialName("error") val error: String? = null,
    @SerialName("etaSeconds") val etaSeconds: Double? = null,
    @SerialName("missingImages") val missingImages: JsonElement? = null,
)

@Serializable
data class PdfAuftragTeil(
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("color_id") val colorId: Int? = null,
    @SerialName("quantity") val quantity: Int,
    @SerialName("is_fig") val isFig: Boolean = false,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
)

@Serializable
data class PdfEingabe(
    @SerialName("sets") val sets: List<PdfEingabeSetsEintrag> = emptyList(),
    @SerialName("parts") val parts: List<PdfEingabePartsEintrag> = emptyList(),
)

@Serializable
data class PdfEingabePartsEintrag(
    @SerialName("part_number") val partNumber: String = "",
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("color_id") val colorId: Int? = null,
    @SerialName("quantity") val quantity: JsonElement = JsonNull,
    @SerialName("is_fig") val isFig: JsonElement? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
)

@Serializable
data class PdfEingabeSetsEintrag(
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("name") val name: String? = null,
)

@Serializable
data class PendingAlertsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("alerts") val alerts: List<Preisalarm> = emptyList(),
    @SerialName("now") val now: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class PnlResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("currency") val currency: Waehrung = Waehrung.EUR,
    @SerialName("totals") val totals: PnlTotals,
    @SerialName("sets") val sets: List<PnlSetZeile> = emptyList(),
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
    @SerialName("year") val year: Int? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("quantity") val quantity: Int = 1,
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
    @SerialName("kaufpreise_umgerechnet") val kaufpreiseUmgerechnet: Int? = null,
    @SerialName("pnl_current") val pnlCurrent: JsonElement? = null,
    @SerialName("pnl_purchase") val pnlPurchase: JsonElement? = null,
    @SerialName("purchase") val purchase: String,
    @SerialName("current") val current: String,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("kaufpreise_fremde_waehrung") val kaufpreiseFremdeWaehrung: Int = 0,
    @SerialName("sets_purchase") val setsPurchase: String? = null,
    @SerialName("parts_purchase") val partsPurchase: String? = null,
    @SerialName("figs_purchase") val figsPurchase: String? = null,
    @SerialName("grand_total") val grandTotal: String? = null,
    @SerialName("positionen") val positionen: Int? = null,
    @SerialName("positionen_bewertet") val positionenBewertet: Int? = null,
    @SerialName("positionen_ohne_marktpreis") val positionenOhneMarktpreis: Int? = null,
    @SerialName("positionen_ohne_kaufpreis") val positionenOhneKaufpreis: Int? = null,
    @SerialName("basis_einstand") val basisEinstand: String? = null,
    @SerialName("basis_marktwert") val basisMarktwert: String? = null,
    @SerialName("basis_guv_betrag") val basisGuvBetrag: String? = null,
    @SerialName("ohne_marktpreis_einstand") val ohneMarktpreisEinstand: String? = null,
    @SerialName("ohne_kaufpreis_marktwert") val ohneKaufpreisMarktwert: String? = null,
)

@Serializable
data class PortfolioHistoryResponse(
    @SerialName("chart") val chart: PriceChartData? = null,
    @SerialName("messpunkte") val messpunkte: Int? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("currency") val currency: Waehrung = Waehrung.EUR,
    @SerialName("period") val period: String = "week",
    @SerialName("points") val points: List<ChartPoint> = emptyList(),
    @SerialName("y_axis") val yAxis: List<ChartYAxis> = emptyList(),
    @SerialName("period_change_pct") val periodChangePct: Double? = null,
    @SerialName("purchase_total") val purchaseTotal: String? = null,
)

@Serializable
data class PreisJobStand(
    @SerialName("success") val success: Boolean = false,
    @SerialName("job") val job: PreisJobStandJob = PreisJobStandJob(),
    @SerialName("rate_limit") val rateLimit: PreisJobStandRateLimit = PreisJobStandRateLimit(),
)

@Serializable
data class PreisJobStandJob(
    @SerialName("running") val running: Boolean = false,
    @SerialName("lastRun") val lastRun: String? = null,
    @SerialName("nextRun") val nextRun: String? = null,
    @SerialName("lastErrors") val lastErrors: Int = 0,
    @SerialName("log") val log: List<JsonElement?> = emptyList(),
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
    @SerialName("count") val count: Int = 0,
    @SerialName("limit") val limit: Int = 0,
    @SerialName("remaining") val remaining: Int = 0,
    @SerialName("date") val date: String? = null,
)

@Serializable
data class Preisalarm(
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("condition") val condition: Zustand = Zustand.NEU,
    @SerialName("richtung") val richtung: Alarmrichtung = Alarmrichtung.UNTER,
    @SerialName("schwelle") val schwelle: Double = 0.0,
    @SerialName("currency_code") val currencyCode: Waehrung = Waehrung.KEINE,
    @SerialName("ausgeloest") val ausgeloest: Boolean = false,
    @SerialName("zuletzt_am") val zuletztAm: String? = null,
    @SerialName("zuletzt_preis") val zuletztPreis: Double? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("set_img_url") val setImgUrl: String? = null,
    @SerialName("besitzt") val besitzt: Boolean = true,
)

@Serializable
data class PreisalarmRequest(
    @SerialName("richtung") val richtung: Alarmrichtung,
    @SerialName("schwelle") val schwelle: Double,
    @SerialName("condition") val condition: Zustand = Zustand.NEU,
)

@Serializable
data class PreisalarmResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("alert") val alert: Preisalarm? = null,
    @SerialName("removed") val removed: Int = 0,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class PreisalarmeResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("alerts") val alerts: List<Preisalarm> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class PriceByCondition(
    @SerialName("N") val new: ConditionValuation? = null,
    @SerialName("U") val used: ConditionValuation? = null,
)

@Serializable
data class PriceChartData(
    @SerialName("values") val values: List<PriceChartSeries> = emptyList(),
    @SerialName("x") val x: List<String> = emptyList(),
)

@Serializable
data class PriceChartPoint(
    @SerialName("x") val x: String = "",
    @SerialName("y") val y: Double = 0.0,
)

@Serializable
data class PriceChartSeries(
    @SerialName("name") val name: String = "",
    @SerialName("values") val values: List<PriceChartPoint> = emptyList(),
    @SerialName("firstRealIndex") val firstRealIndex: Int = 0,
)

@Serializable
data class PriceHistoryPoint(
    @SerialName("is_purchase_price") val isPurchasePrice: Boolean = false,
    @SerialName("recorded_at") val recordedAt: String = "",
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
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("currency") val currency: Waehrung = Waehrung.KEINE,
    @SerialName("history_new") val historyNew: List<PriceHistoryPoint> = emptyList(),
    @SerialName("history_used") val historyUsed: List<PriceHistoryPoint> = emptyList(),
    @SerialName("by_condition") val byCondition: PriceByCondition = PriceByCondition(),
    @SerialName("chart") val chart: PriceChartData = PriceChartData(),
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
)

@Serializable
data class Profil(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String,
    @SerialName("email") val email: String? = null,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    @SerialName("email_verified") val emailVerified: Boolean = false,
    @SerialName("email_neu") val emailNeu: String? = null,
)

@Serializable
data class ProfilAenderung(
    @SerialName("username") val username: String,
    @SerialName("email") val email: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    @SerialName("password") @EncodeDefault(EncodeDefault.Mode.NEVER) val password: String? = null,
    @SerialName("password_current") val passwordCurrent: String? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class ProfilGespeichert(
    @SerialName("new_quantity") val newQuantity: Int? = null,
    @SerialName("from_user_id") val fromUserId: Int? = null,
    @SerialName("to_user_id") val toUserId: Int? = null,
    @SerialName("merged") val merged: Boolean = false,
    @SerialName("unchanged") val unchanged: Boolean = false,
    @SerialName("acquisitions") val acquisitions: Int? = null,
    @SerialName("instructions") val instructions: Int? = null,
    @SerialName("papierkorb") val papierkorb: JsonElement = JsonNull,
    @SerialName("removed") val removed: Int? = null,
    @SerialName("linked_to") val linkedTo: KontoName? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String? = null,
    @SerialName("set") val set: SetAggregate? = null,
    @SerialName("parts") val parts: Int? = null,
    @SerialName("minifigs") val minifigs: Int? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean = false,
    @SerialName("quantity") val quantity: Int? = null,
    @SerialName("degradiert") val degradiert: List<String> = emptyList(),
    @SerialName("emailChanged") val emailChanged: Boolean? = null,
    @SerialName("emailSent") val emailSent: Boolean? = null,
)

@Serializable
data class ProfilResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("user") val user: Profil? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class ProtokollEintraege(
    @SerialName("success") val success: Boolean = false,
    @SerialName("eintraege") val eintraege: List<JsonObject> = emptyList(),
)

@Serializable
data class ProtokollResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("minutes") val minutes: Int = 0,
    @SerialName("count") val count: Int = 0,
    @SerialName("logs") val logs: List<ProtokollZeile> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class ProtokollZeile(
    @SerialName("id") val id: Int? = null,
    @SerialName("level") val level: String? = null,
    @SerialName("message") val message: String? = null,
    @SerialName("logged_at") val loggedAt: String? = null,
)

@Serializable
data class QrAbholRequest(
    @SerialName("abholung") val abholung: String,
    @SerialName("vorschau") val vorschau: Boolean = false,
)

@Serializable
data class QrAbholung(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("user") val user: User? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("zweiter_faktor") val zweiterFaktor: Boolean = false,
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
    @SerialName("keks_fehlt") val keksFehlt: Boolean = false,
    @SerialName("wartet") val wartet: Boolean = false,
    @SerialName("username") val username: String? = null,
    @SerialName("isAdmin") val isAdmin: Boolean = false,
    @SerialName("userId") val userId: Int = 0,
    @SerialName("vorschau") val vorschau: Boolean = false,
    @SerialName("schluessel_nonce") val schluesselNonce: String? = null,
)

@Serializable
data class QrKopplungStand(
    @SerialName("success") val success: Boolean = false,
    @SerialName("stand") val stand: String = "",
    @SerialName("geraet") val geraet: String? = null,
    @SerialName("ip_bereich") val ipBereich: String? = null,
)

@Serializable
data class QrLoginRequest(
    @SerialName("token") val token: String,
    @SerialName("label") val label: String = "Android App",
)

@Serializable
data class QrMeldung(
    @SerialName("success") val success: Boolean,
    @SerialName("wartet") val wartet: Boolean = false,
    @SerialName("abholung") val abholung: String = "",
    @SerialName("code") val code: String = "",
    @SerialName("expires_in") val expiresIn: Int = 300,
)

@Serializable
data class QrToken(
    @SerialName("success") val success: Boolean = false,
    @SerialName("token") val token: String = "",
    @SerialName("kopplung") val kopplung: Int = 0,
    @SerialName("expires_in") val expiresIn: Int = 0,
    @SerialName("url") val url: String = "",
    @SerialName("token_days") val tokenDays: Int? = null,
    @SerialName("fp") val fp: String = "",
    @SerialName("zert_sha256") val zertSha256: String = "",
)

@Serializable
data class QrVerwerfen(
    @SerialName("abholung") val abholung: String,
)

@Serializable
data class RateLimit(
    @SerialName("date") val date: String? = null,
    @SerialName("count") val count: Int = 0,
    @SerialName("limit") val limit: Int = 0,
    @SerialName("remaining") val remaining: Int = 0,
)

@Serializable
data class RateLimits(
    @SerialName("bricklink") val bricklink: RateLimit = RateLimit(),
    @SerialName("rebrickable") val rebrickable: RateLimit = RateLimit(),
    @SerialName("brickset") val brickset: RateLimit = RateLimit(),
)

@Serializable
data class RegisterRequest(
    @SerialName("username") val username: String,
    @SerialName("email") val email: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    @SerialName("password") val password: String,
    @SerialName("language") val language: String = "de",
)

@Serializable
data class RegisterResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("message") val message: String? = null,
    @SerialName("email_sent") val emailSent: Boolean = false,
    @SerialName("console_mode") val consoleMode: Boolean = false,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class RegistrationStatusResponse(
    @SerialName("enabled") val enabled: Boolean = false,
    @SerialName("passkey") val passkey: Boolean = false,
    @SerialName("passwort_vergessen") val passwortVergessen: Boolean = false,
    @SerialName("mail_versand") val mailVersand: Boolean = false,
)

@Serializable
data class RoheEinstellungen(
    @SerialName("success") val success: Boolean = false,
    @SerialName("settings") val settings: Map<String, String> = emptyMap(),
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
data class SchrittChallengeAnfrage(
    @SerialName("aktion") val aktion: String,
)

@Serializable
data class SchrittFreigabe(
    @SerialName("success") val success: Boolean,
    @SerialName("aktion") val aktion: String,
    @SerialName("gueltig_bis") val gueltigBis: String,
)

@Serializable
data class SchrittFreigabeAnfrage(
    @SerialName("challenge") val challenge: String,
    @SerialName("signatur") val signatur: String,
)

@Serializable
data class SetAggregate(
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("condition") val condition: Zustand? = null,
    @SerialName("acq_count") val acqCount: Int? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    @SerialName("conditions") val conditions: List<Zustand> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
)

@Serializable
data class SetExistsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("exists") val exists: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("is_self") val isSelf: Boolean = false,
)

@Serializable
data class SetInfoResponse(
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("minifigs") val minifigs: Int? = null,
    @SerialName("pieces") val pieces: Int? = null,
    @SerialName("theme") val theme: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("success") val success: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("name") val name: String? = null,
    @SerialName("im_katalog") val imKatalog: Boolean = false,
)

@Serializable
data class SetItem(
    @SerialName("acq_count") val acqCount: Int? = null,
    @SerialName("letzter_kauf") val letzterKauf: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Int> = emptyList(),
    @SerialName("id") val id: Int? = null,
    @SerialName("storage_id") val storageId: Int? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("user_id") val userId: Int? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("theme") val theme: String? = null,
    @SerialName("pieces") val pieces: Int? = null,
    @SerialName("minifigs") val minifigs: Int? = null,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("added_at") val addedAt: String? = null,
    @SerialName("condition") val condition: Zustand? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("conditions") val conditions: List<Zustand> = emptyList(),
    @SerialName("owners") val owners: List<KontoName> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("kaufpreis_geschaetzt") val kaufpreisGeschaetzt: Boolean? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    @SerialName("instructions") val instructions: List<Instruction> = emptyList(),
    @SerialName("bricklink") val bricklink: BrickLinkRef? = null,
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null,
)

@Serializable
data class SetPriceResponse(
    @SerialName("from_cache") val fromCache: Boolean = false,
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("currency") val currency: Waehrung = Waehrung.KEINE,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("no_price") val noPrice: Boolean = false,
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
    @SerialName("count") val count: Int = 0,
    @SerialName("sets") val sets: List<SetItem> = emptyList(),
    @SerialName("total") val total: Int = 0,
    @SerialName("themes") val themes: List<String> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class SettingsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("settings") val settings: UserSettings = UserSettings(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Sicherung(
    @SerialName("version") val version: String = "",
    @SerialName("exported_at") val exportedAt: String = "",
    @SerialName("exported_by") val exportedBy: String? = null,
    @SerialName("global") val global: Map<String, String> = emptyMap(),
    @SerialName("user_settings") val userSettings: Map<String, String> = emptyMap(),
)

@Serializable
data class SicherungEingespielt(
    @SerialName("success") val success: Boolean = false,
    @SerialName("imported") val imported: Int = 0,
    @SerialName("note") val note: String = "",
    @SerialName("smtp_uebergangen") val smtpUebergangen: List<String> = emptyList(),
)

@Serializable
data class SmtpProbe(
    @SerialName("mode") val mode: String? = null,
    @SerialName("success") val success: Boolean = false,
)

@Serializable
data class StartupStatus(
    @SerialName("fehler") val fehler: String? = null,
    @SerialName("pfad") val pfad: String? = null,
    @SerialName("ready") val ready: Boolean = false,
    @SerialName("step") val step: String? = null,
    @SerialName("progress") val progress: Double = 0.0,
    @SerialName("total") val total: Int = 0,
    @SerialName("sub") val sub: String? = null,
)

@Serializable
data class StatsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("stats") val stats: DashboardStats? = null,
)

@Serializable
data class TeilFarbeRequest(
    @SerialName("color_id") val colorId: Int,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
)

@Serializable
data class TeilFarbeResponse(
    @SerialName("bild") val bild: String? = null,
    @SerialName("success") val success: Boolean = false,
    @SerialName("zusammengelegt") val zusammengelegt: Boolean = false,
    @SerialName("verschoben") val verschoben: Int = 0,
    @SerialName("vereint") val vereint: Int = 0,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class TeileGeladen(
    @SerialName("success") val success: Boolean = false,
    @SerialName("count") val count: Int = 0,
)

@Serializable
data class TlsStand(
    @SerialName("success") val success: Boolean = false,
    @SerialName("https") val https: Boolean = false,
    @SerialName("fp") val fp: String? = null,
    @SerialName("fp_hex") val fpHex: String = "",
    @SerialName("zert_sha256") val zertSha256: String = "",
    @SerialName("subject") val subject: String = "",
    @SerialName("gueltig_bis") val gueltigBis: String = "",
    @SerialName("download") val download: String = "",
)

@Serializable
data class TokenErstellt(
    @SerialName("success") val success: Boolean = false,
    @SerialName("token") val token: String = "",
    @SerialName("label") val label: String? = null,
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
)

@Serializable
data class TokenInfo(
    @SerialName("scope") val scope: String,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("hard_expires_at") val hardExpiresAt: String? = null,
    @SerialName("never_expires") val neverExpires: Boolean,
    @SerialName("rotiert_am") val rotiertAm: String? = null,
    @SerialName("rotation_faellig") val rotationFaellig: Boolean = false,
)

@Serializable
data class TokenRotation(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
    @SerialName("alt_gueltig_bis") val altGueltigBis: String? = null,
    @SerialName("ueberlappung_sek") val ueberlappungSek: Int? = null,
)

@Serializable
data class TokenWiderruf(
    @SerialName("success") val success: Boolean,
    @SerialName("deleted") val deleted: Int = 0,
)

@Serializable
data class TokensResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("tokens") val tokens: List<AppToken> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Totals(
    @SerialName("min") val min: String = "0.00",
    @SerialName("avg") val avg: String = "0.00",
    @SerialName("max") val max: String = "0.00",
    @SerialName("qty_avg") val qtyAvg: String = "0.00",
)

@Serializable
data class UpdateAcquisitionRequest(
    @SerialName("quantity") val quantity: Int? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("condition") val condition: Zustand? = null,
    @SerialName("date") val date: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("from_user_id") @EncodeDefault(EncodeDefault.Mode.NEVER) val fromUserId: JsonElement? = null,
)

@Serializable
data class UpdateManualItemRequest(
    @SerialName("quantity") val quantity: Int,
    @SerialName("quantity_delta") @EncodeDefault(EncodeDefault.Mode.NEVER) val quantityDelta: Int? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("condition") val condition: Zustand? = null,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
)

@Serializable
data class UpdateQuantityRequest(
    @SerialName("quantity") @EncodeDefault(EncodeDefault.Mode.NEVER) val quantity: Int? = null,
    @SerialName("quantity_delta") @EncodeDefault(EncodeDefault.Mode.NEVER) val quantityDelta: Int? = null,
    @SerialName("purchase_price") @EncodeDefault(EncodeDefault.Mode.NEVER) val purchasePrice: Double? = null,
    @SerialName("condition") @EncodeDefault(EncodeDefault.Mode.NEVER) val condition: Zustand? = null,
    @SerialName("owner_user_id") @EncodeDefault(EncodeDefault.Mode.NEVER) val ownerUserId: JsonElement? = null,
)

@Serializable
data class User(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String,
    @SerialName("is_admin") val isAdmin: Boolean = false,
    @SerialName("mustChangePassword") val mustChangePassword: Boolean = false,
    @SerialName("zweiterFaktorPflicht") val zweiterFaktorPflicht: Boolean = false,
)

@Serializable
data class UserSettings(
    @SerialName("currency") val currency: Waehrung = Waehrung.EUR,
    @SerialName("price_condition") val priceCondition: Zustand = Zustand.NEU,
    @SerialName("price_cache_ttl") val priceCacheTtl: String = "24",
    @SerialName("default_price_condition") val defaultPriceCondition: Zustand = Zustand.NEU,
    @SerialName("user_default_condition") val userDefaultCondition: Zustand? = null,
    @SerialName("effective_condition") val effectiveCondition: Zustand = Zustand.NEU,
    @Serializable(with = DesignOderNichts::class) @SerialName("app_theme") val appTheme: Design? = null,
)

@Serializable
data class ValuationAcquisition(
    @SerialName("id") val id: Int = 0,
    @SerialName("condition") val condition: Zustand = Zustand.NEU,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("kaufpreis_original") val kaufpreisOriginal: Double = 0.0,
    @SerialName("kaufpreis_waehrung") val kaufpreisWaehrung: String = "",
    @SerialName("price_estimated") val priceEstimated: Boolean = false,
)

@Serializable
data class ValuationResponse(
    @SerialName("kaufpreise_umgerechnet") val kaufpreiseUmgerechnet: Int? = null,
    @SerialName("guide_type") val guideType: String? = null,
    @SerialName("ttl_hours") val ttlHours: JsonElement? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("total_value") val totalValue: String = "",
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("preise_ausstehend") val preiseAusstehend: Int = 0,
    @SerialName("currency") val currency: Waehrung = Waehrung.EUR,
    @SerialName("condition") val condition: Zustand = Zustand.NEU,
    @SerialName("ttl_stunden") val ttlStunden: Int? = null,
    @SerialName("kaufpreise_fremde_waehrung") val kaufpreiseFremdeWaehrung: Int = 0,
    @SerialName("sets") val sets: List<ValuationSet> = emptyList(),
    @SerialName("totals") val totals: Totals = Totals(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class ValuationSet(
    @SerialName("bl_unbekannt") val blUnbekannt: Boolean = false,
    @SerialName("condition") val condition: String? = null,
    @SerialName("conditions") val conditions: List<String> = emptyList(),
    @SerialName("error_code") val errorCode: String? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("user_id") val userId: Int? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("added_at") val addedAt: String? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("total_qty_avg") val totalQtyAvg: String? = null,
    @SerialName("preis_ausstehend") val preisAusstehend: Boolean = false,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("wert_gesamt") val wertGesamt: Double? = null,
    @SerialName("pnl_prozent") val pnlProzent: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("from_cache") val fromCache: Boolean = true,
    @SerialName("is_fallback") val isFallback: Boolean = false,
    @SerialName("condition_used") val conditionUsed: Zustand? = null,
    @SerialName("no_price") val noPrice: Boolean = false,
    @SerialName("acquisitions") val acquisitions: List<ValuationAcquisition> = emptyList(),
    @SerialName("mixed") val mixed: Boolean = false,
    @SerialName("owners") val owners: List<KontoName> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class VerwendendeSetsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("item") val item: BestandteilKopf? = null,
    @SerialName("sets") val sets: List<VerwendendesSet> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class VerwendendesSet(
    @SerialName("set_number") val setNumber: String,
    @SerialName("set_name") val setName: String? = null,
    @SerialName("quantity") val quantity: Int = 0,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int = 0,
)

@Serializable
data class WantedXmlErgebnis(
    @SerialName("success") val success: Boolean = false,
    @SerialName("vorschau") val vorschau: Boolean = false,
    @SerialName("gelesen") val gelesen: Int = 0,
    @SerialName("angelegt") val angelegt: Int = 0,
    @SerialName("aufgestockt") val aufgestockt: Int = 0,
    @SerialName("fehler") val fehler: Int = 0,
    @SerialName("posten") val posten: List<WantedXmlErgebnisPostenEintrag> = emptyList(),
    @SerialName("offen") val offen: List<WantedXmlErgebnisOffenEintrag> = emptyList(),
    @SerialName("fremdeArten") val fremdeArten: Map<String, Int> = emptyMap(),
    @SerialName("ohneNummer") val ohneNummer: Int = 0,
    @SerialName("stufen") val stufen: Map<String, Int> = emptyMap(),
    @SerialName("farbeOffen") val farbeOffen: Int = 0,
    @SerialName("standardZustand") val standardZustand: String = "",
    @SerialName("abgebrochen") val abgebrochen: Boolean = false,
    @SerialName("korrekturen") val korrekturen: WantedXmlErgebnisKorrekturen = WantedXmlErgebnisKorrekturen(),
    @SerialName("rebrickable") val rebrickable: WantedXmlErgebnisRebrickable = WantedXmlErgebnisRebrickable(),
)

@Serializable
data class WantedXmlErgebnisKorrekturen(
    @SerialName("angewandt") val angewandt: Int = 0,
    @SerialName("abgewiesen") val abgewiesen: List<JsonElement?> = emptyList(),
)

@Serializable
data class WantedXmlErgebnisOffenEintrag(
    @SerialName("art") val art: String = "",
    @SerialName("blId") val blId: String = "",
    @SerialName("blFarbe") val blFarbe: Int? = null,
)

@Serializable
data class WantedXmlErgebnisPostenEintrag(
    @SerialName("art") val art: String = "",
    @SerialName("blId") val blId: String = "",
    @SerialName("menge") val menge: Int = 0,
    @SerialName("ausgang") val ausgang: String = "",
    @SerialName("blFarbe") val blFarbe: Int? = null,
    @SerialName("rbId") val rbId: String? = null,
    @SerialName("rbFarbe") val rbFarbe: Int? = null,
    @SerialName("farbName") val farbName: String? = null,
    @SerialName("farbHex") val farbHex: String? = null,
    @SerialName("sicherheit") val sicherheit: String? = null,
    @SerialName("zustand") val zustand: String? = null,
    @SerialName("maxPreis") val maxPreis: Double? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("nameGeraten") val nameGeraten: Boolean = false,
    @SerialName("bild") val bild: String? = null,
    @SerialName("grund") val grund: String? = null,
    @SerialName("grundCode") val grundCode: String? = null,
)

@Serializable
data class WantedXmlErgebnisRebrickable(
    @SerialName("gefragt") val gefragt: Int = 0,
    @SerialName("gefunden") val gefunden: Int = 0,
    @SerialName("filterWirkungslos") val filterWirkungslos: Boolean = false,
    @SerialName("abgebrochen") val abgebrochen: String = "",
)

@Serializable
data class Wiederhergestellt(
    @SerialName("success") val success: Boolean = false,
    @SerialName("art") val art: String = "",
    @SerialName("nummer") val nummer: String = "",
    @SerialName("user_id") val userId: Int = 0,
)

@Serializable
data class ZweiterFaktorAnfrage(
    @SerialName("password") val password: String? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class ZweiterFaktorCodes(
    @SerialName("success") val success: Boolean,
    @SerialName("codes") val codes: List<String> = emptyList(),
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
    @SerialName("aktiv") val aktiv: Boolean = false,
    @SerialName("codes_uebrig") val codesUebrig: Int = 0,
    @SerialName("error") val error: String? = null,
)
