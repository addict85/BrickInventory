package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Monitoring, Grenzwerte, Einstellungen und Katalog — ein Sachgebiet der Modelle.
 * Getrennte Dateien, damit parallele Änderungen nicht immer dieselbe Datei
 * berühren; das Paket bleibt ch.brickinventoryapp.data.model, Kotlin bindet an das
 * Paket, nicht an die Datei.
 */

/**
 * Wie viele Sets je Jahr — mit den aktuellen Filtern und in der Reihenfolge der
 * Sortierung (GET /api/v1/catalog/year-verteilung). `year` darf null sein: Sets
 * ohne Jahresangabe; Postgres sortiert sie absteigend nach vorne, und die Antwort
 * gibt sie so heraus, wie die Liste sie führt.
 */
@Serializable
data class JahrAnzahl(
    val year: Int? = null,
    val n: Int = 0
)

/**
 * Antwort auf „wie verteilen sich die Sets über die Jahre?“ — vom Server, weil nur
 * er die Filter kennt; eine Verteilung über den ganzen Katalog läge bei gesetztem
 * Thema oder Suchtext daneben.
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
 * Der Zeitplan eines Jobs — täglich zu einer Uhrzeit oder alle N Minuten. Gelesen,
 * damit die App wie die Webapp zeigt, wann ein Job das nächste Mal läuft, und es
 * ändern kann.
 *
 * @param type    "daily" (dann zählt `time`) oder "interval" (dann `minutes`)
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
 * BrickLink-Verweis, fertig vom Server aufgelöst (utils/bricklinkLink.ts). Nicht
 * im Client gebaut: Ob eine Rebrickable-Nummer auf BrickLink ein Set, Gear oder
 * ein Buch ist, weiss nur der Server über catalog_cache, und die Regel darf nicht
 * in Webapp und App doppelt liegen. url ist null, wenn der Artikel dort nicht
 * gelistet ist.
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
    val bricklink: BrickLinkRef? = null,
    /**
     * Preisvergleich, fertig vom Server (utils/preisvergleich.ts) — wie beim
     * Set-Detail steht die Adresse genau einmal im Baum. Verbraucher ist das
     * Merkposten-Detail, wo „was kostet das anderswo?“ der wichtigste Griff ist.
     */
    @SerialName("preisvergleich_url") val preisvergleichUrl: String? = null
)

@Serializable
data class CatalogSetDetailResponse(
    val success: Boolean,
    val set: CatalogSetDetail? = null,
    val error: String? = null
)

// ── Hintergrundarbeiten (Auftragstabelle, /api/v1/admin/auftraege) ────────────
//
// Ohne Standardwerte, wo der Server das Feld immer liefert: Fehlt eines, soll
// das beim Lesen auffallen statt still als 0 oder leer zu erscheinen.

@Serializable
data class AuftraegeResponse(
    val success: Boolean,
    val auftraege: List<Auftrag>,
    val zusammenfassung: List<AuftragZaehler>,
    val pausen: List<AuftragPause>,
    val bildbedarf: Int,
    @SerialName("job_prozess") val jobProzess: JobProzess,
)

@Serializable
data class Auftrag(
    val id: String,
    val art: String,
    val status: String,
    val versuche: Int,
    @SerialName("max_versuche") val maxVersuche: Int,
    @SerialName("faellig_ab") val faelligAb: String?,
    @SerialName("frist_bis") val fristBis: String?,
    val gestartet: String?,
    val erstellt: String?,
    val aktualisiert: String?,
    val fortschritt: AuftragFortschritt?,
    val fehler: String?,
    @SerialName("user_id") val userId: Int?,
    val geplant: Boolean,
    @SerialName("set_number") val setNumber: String?,
)

/** Jeder Auftrag füllt, was er kann; alles ist freiwillig. */
@Serializable
data class AuftragFortschritt(val erledigt: Int? = null, val gesamt: Int? = null, val text: String? = null)

@Serializable
data class AuftragZaehler(val art: String, val status: String, val anzahl: Int)

@Serializable
data class AuftragPause(val art: String, val bis: String?, val grund: String?)

/** Lebenszeichen des Job-Prozesses; [laeuft] false heisst: niemand arbeitet die Aufträge ab. */
@Serializable
data class JobProzess(
    val lebenszeichen: String?,
    @SerialName("alter_sekunden") val alterSekunden: Int?,
    val laeuft: Boolean,
)

@Serializable
data class AuftragAenderung(val success: Boolean, val id: String, val status: String)

@Serializable
data class AuftragsArtStart(val success: Boolean, val art: String, val gestartet: Boolean)

@Serializable
data class AuftragsArtLeerung(val success: Boolean, val art: String, val entfernt: Int)
