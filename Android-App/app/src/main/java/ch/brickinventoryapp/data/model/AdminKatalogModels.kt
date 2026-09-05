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
 * Wie viele Sets je Jahr — MIT den aktuellen Filtern und in der Reihenfolge
 * der Sortierung (GET /api/v1/catalog/year-verteilung).
 *
 * `year` darf null sein: Sets ohne Jahresangabe. Postgres sortiert die bei
 * absteigender Sortierung nach vorne, und die Antwort gibt sie so heraus, wie
 * die Liste sie fuehrt.
 */
@Serializable
data class JahrAnzahl(
    val year: Int? = null,
    val n: Int = 0
)

/**
 * Antwort auf „wie verteilen sich die Sets ueber die Jahre?"
 *
 * Vom SERVER, weil nur er die Filter kennt — eine Verteilung ueber den ganzen
 * Katalog laege bei gesetztem Thema oder Suchtext genauso daneben wie eine
 * lineare Schaetzung.
 */
@Serializable
data class CatalogYearVerteilungResponse(
    val success: Boolean = false,
    val years: List<JahrAnzahl> = emptyList()
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

/**
 * Der Zeitplan eines Jobs — taeglich zu einer Uhrzeit, oder alle N Minuten.
 *
 * ── Warum das Feld erst jetzt gelesen wird (Nachtrag 137) ───────────────────
 *
 * `/api/v1/admin/jobs` schickt `schedules` seit jeher mit (routes/api_v1/
 * admin.ts) — die App hat es nie eingelesen. Sie zeigte also, DASS ein Job
 * laeuft, aber nicht WANN er das naechste Mal laeuft, und aendern konnte sie
 * es schon gar nicht. Die Webapp zeigt beides.
 *
 * Wieder ein Feld, das ueber die Leitung kommt und niemanden erreicht — nur
 * diesmal von der anderen Seite als sonst: nicht geschrieben und nie gelesen,
 * sondern GESCHICKT und nie ausgepackt.
 *
 * @param type    "daily" (dann zaehlt `time`) oder "interval" (dann `minutes`)
 * @param time    "HH:MM" — Ortszeit des Servers
 * @param minutes Abstand in Minuten; der Server erzwingt mindestens 5
 */
@Serializable
data class JobSchedule(
    val type: String = "daily",
    val time: String? = null,
    val minutes: Int? = null,
)

@Serializable
data class JobsResponse(
    val success: Boolean,
    val jobs: Map<String, JobStatus> = emptyMap(),
    val schedules: Map<String, JobSchedule> = emptyMap(),
)

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
