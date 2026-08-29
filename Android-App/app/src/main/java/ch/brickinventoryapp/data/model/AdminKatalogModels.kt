package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Monitoring, Grenzwerte, Einstellungen und Katalog.
 *
 * ── Warum diese Datei existiert (Nachtrag 155) ──────────────────────────────
 *
 * Alle 92 Datenklassen der App standen in EINER Datei, Models.kt, mit 1158
 * Zeilen. Jede Aenderung an irgendeinem Modell beruehrte dieselbe Datei — bei
 * parallelen Aenderungen ein sicherer Konflikt, und beim Suchen war der Weg
 * immer derselbe: eine Datei oeffnen und scrollen.
 *
 * Aufgeteilt wurde entlang der Sachgebiete. Die Klassen selbst sind WORTGLEICH
 * uebernommen: Es wurde nichts umbenannt, nichts zusammengefasst und kein Feld
 * angefasst. Sie liegen weiter im Paket ch.brickinventoryapp.data.model, also
 * aendert sich fuer keinen Aufrufer etwas — Kotlin bindet an das Paket, nicht
 * an die Datei.
 */

/**
 * Antwort auf „an welcher Stelle der Liste beginnt dieses Jahr?"
 * (GET /api/v1/catalog/year-offset) — die Rechnung hinter dem Schnell-Scroll.
 *
 * Der Katalog hat rund 25 000 Sets und wird seitenweise geliefert; wohin ein
 * Jahr gehört, weiss nur die Datenbank. `offset` ist die laufende Nummer des
 * ersten Sets dieses Jahres, `page` die Seite, auf der es liegt.
 */
@Serializable
data class CatalogYearOffsetResponse(
    val success: Boolean = false,
    val offset: Int = 0,
    val page: Int = 1,
    val total: Int = 0
)

@Serializable
data class RateLimit(val count: Int = 0, val limit: Int = 0, val remaining: Int = 0)

@Serializable
data class CacheStatsResponse(
    val success: Boolean,
    val prices: Int = 0,
    val subsets: Int = 0,
    val catalog: Int = 0,
    @SerialName("price_stale") val priceStale: Int = 0,
    @SerialName("rate_limits") val rateLimits: RateLimits? = null
)

@Serializable
data class RateLimits(
    val bricklink: RateLimit = RateLimit(),
    val rebrickable: RateLimit = RateLimit(),
    val brickset: RateLimit = RateLimit()
)

@Serializable
data class ApiLimits(val rebrickable: Int = 0, val bricklink: Int = 0, val brickset: Int = 0)

@Serializable
data class ApiLimitsResponse(val success: Boolean, val limits: ApiLimits = ApiLimits())

@Serializable
data class CacheTtlResponse(val success: Boolean, val ttl: String = "24")

// ── Monitoring models ─────────────────────────────────────────────────────────
@Serializable
data class JobStatus(
    val label: String = "",
    val status: String = "idle",
    val progress: Int = 0,
    val total: Int = 0,
    val sub: String? = null
)

@Serializable
data class JobsResponse(val success: Boolean, val jobs: Map<String, JobStatus> = emptyMap())

@Serializable
data class BricksetQueueEntry(
    @SerialName("set_number") val setNumber: String,
    val name: String? = null,
    val attempts: Int = 0,
    @SerialName("retry_after") val retryAfter: String? = null,
    @SerialName("last_error") val lastError: String? = null
)

@Serializable
data class BricksetQueueResponse(
    val success: Boolean,
    val count: Int = 0,
    val entries: List<BricksetQueueEntry> = emptyList()
)

@Serializable
data class GenericAdminResponse(val success: Boolean, val error: String? = null, val enqueued: Int = 0)

// ── Katalog (Rebrickable-Set-Katalog, /api/v1/catalog/*) ─────────────────────

@Serializable
data class CatalogTheme(
    val id: Int,
    val name: String,
    @SerialName("set_count") val setCount: Int = 0
)

@Serializable
data class CatalogYearCount(
    val year: Int,
    val n: Int = 0
)

@Serializable
data class CatalogMetaResponse(
    val success: Boolean,
    val themes: List<CatalogTheme> = emptyList(),
    @SerialName("year_min") val yearMin: Int? = null,
    @SerialName("year_max") val yearMax: Int? = null,
    @SerialName("year_counts") val yearCounts: List<CatalogYearCount> = emptyList(),
    val error: String? = null
)

@Serializable
data class CatalogSetItem(
    @SerialName("set_number") val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    @SerialName("theme_id") val themeId: Int? = null,
    @SerialName("theme_name") val themeName: String? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    // Vom Server ermittelt: existiert bereits eine lokale Kopie unter
    // public/images/sets/<setnummer>.jpg? Nutzerunabhängig — irgendein Nutzer
    // hat dieses Set eventuell schon einmal seinem Bestand hinzugefügt.
    @SerialName("image_local") val imageLocal: String? = null,
    val owned: Boolean = false,
    @SerialName("owned_quantity") val ownedQuantity: Int = 0
)

@Serializable
data class CatalogSetsResponse(
    val success: Boolean,
    val total: Int = 0,
    val page: Int = 1,
    val pages: Int = 1,
    val sets: List<CatalogSetItem> = emptyList(),
    val error: String? = null
)

/**
 * BrickLink-Verweis, fertig vom Server aufgelöst (utils/bricklinkLink.ts).
 *
 * Die URL wird bewusst NICHT mehr im Client gebaut: ob eine Rebrickable-Nummer
 * auf BrickLink ein Set, Gear oder ein Buch ist, weiss nur der Server über
 * catalog_cache — und die Regel darf nicht in Webapp und App doppelt liegen.
 * url ist null, wenn der Artikel dort gar nicht gelistet ist.
 */
@Serializable
data class BrickLinkRef(
    val type: String = "SET",
    val number: String = "",
    /**
     * Ziel-URL, immer gesetzt. Ist der Artikel nicht eindeutig bestimmbar,
     * zeigt sie auf die BrickLink-Suche statt auf eine Katalogseite.
     */
    val url: String? = null,
    /** true = direkte Katalogseite, false = Suchtrefferliste */
    val exact: Boolean = true,
    val resolved: Boolean = false
)

@Serializable
data class CatalogSetDetail(
    @SerialName("set_number") val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    @SerialName("theme_id") val themeId: Int? = null,
    @SerialName("theme_name") val themeName: String? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    val minifigs: Int = 0,
    val owned: Boolean = false,
    @SerialName("owned_quantity") val ownedQuantity: Int = 0,
    val bricklink: BrickLinkRef? = null
)

@Serializable
data class CatalogSetDetailResponse(
    val success: Boolean,
    val set: CatalogSetDetail? = null,
    val error: String? = null
)
