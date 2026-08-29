package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
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
 * Anmeldung, Einstellungen, Betrieb und Katalog.
 *
 * ── Warum eigene Datei (Nachtrag 155) ───────────────────────────────────────
 *
 * BrickRepository hatte 78 oeffentliche Funktionen in 519 Zeilen und war damit
 * die Anlaufstelle fuer alles zugleich. Die Funktionen sind hier als
 * ERWEITERUNGSFUNKTIONEN abgelegt, nach Sachgebiet getrennt.
 *
 * Fuer Aufrufer aendert sich nichts: `repo.deleteBricksetEntry(...)` loest
 * genauso auf wie zuvor. Die Ruempfe sind WORTGLEICH uebernommen; veraendert
 * wurde nur die Einrueckung und der Empfaenger in der Signatur.
 *
 * Die Begruendung fuer Erweiterungen statt Schnittstellen-Delegation steht in
 * BrickRepository.kt.
 */

// Kein expliziter Authorization-Header mehr nötig: Der OkHttp-Interceptor in
// AppModule setzt "Bearer <token>" automatisch für alle Requests an unseren
// Server (aus dem In-Memory-Cache des PreferencesManagers — kein DataStore-
// Read pro Call mehr). Einzige Ausnahme: getCsvImportStatusDirect, wo der
// Foreground-Service den Token explizit mitgibt.

suspend fun BrickRepository.login(serverUrl: String, username: String, password: String): Result<LoginResponse> =
    safeCall { api.login(LoginRequest(username, password)) }

suspend fun BrickRepository.qrLogin(token: String): Result<LoginResponse> =
    safeCall { api.qrLogin(ch.brickinventoryapp.data.model.QrLoginRequest(token)) }

suspend fun BrickRepository.getSettings(): Result<SettingsResponse> =
    safeCall { api.getSettings() }

suspend fun BrickRepository.updateSettings(currency: String, condition: String): Result<GenericResponse> =
    safeCall { api.updateSettings(mapOf("currency" to currency, "price_condition" to condition)) }

private suspend fun <T> safeCall(call: suspend () -> Response<T>): Result<T> {
    return try {
        val response = call()
        if (response.isSuccessful) {
            response.body()?.let { Result.Success(it) }
                ?: Result.Error("", art = Fehlerart.LEERE_ANTWORT)
        } else {
            // Fehler-Body ({success:false, error:"…"}) auslesen, damit z.B. die
            // Meldung zum Kaufdatum-Konflikt beim Nutzer ankommt statt nur "Conflict".
            val bodyMsg = try {
                val raw = response.errorBody()?.string()
                if (!raw.isNullOrBlank()) org.json.JSONObject(raw).optString("error").takeIf { it.isNotBlank() } else null
            } catch (_: Exception) { null }
            // Servermeldung gewinnt, wenn es eine gibt: Sie ist genauer als
            // jede Einordnung hier. Nur wenn keine da ist, wird die Ursache
            // als Aufzählung gemeldet und die Anzeige formuliert den Satz.
            Result.Error(
                message = bodyMsg ?: "",
                unauthorized = response.code() == 401,
                art = when {
                    bodyMsg != null -> null
                    response.code() == 401 -> Fehlerart.SITZUNG_ABGELAUFEN
                    else -> Fehlerart.SERVER
                },
                httpCode = response.code()
            )
        }
    } catch (e: kotlinx.coroutines.CancellationException) {
        // Abgebrochene Coroutines (z.B. Suche-Debounce ersetzt Request) dürfen
        // nicht als "Netzwerkfehler" im State landen — Cancellation weiterreichen.
        throw e
    } catch (e: java.net.UnknownHostException) {
        // Vorübergehende Netzwerkfehler explizit als transient markieren, statt
        // sie später an der Fehlermeldung zu erraten (retryOnNetwork nutzt das Flag).
        Result.Error("", transient = true, art = Fehlerart.NETZ)
    } catch (e: java.net.ConnectException) {
        Result.Error("", transient = true, art = Fehlerart.NETZ)
    } catch (e: java.net.SocketTimeoutException) {
        Result.Error("", transient = true, art = Fehlerart.ZEIT)
    } catch (e: Exception) {
        // e.message ist hier durchweg englischer Bibliothekstext ("Socket
        // closed", "unexpected end of stream"). Als Meldung an den Nutzer
        // war das nie sinnvoll; sie steht jetzt im Log-Feld statt im Satz.
        Result.Error("", art = Fehlerart.UNBEKANNT, technisch = e.message)
    }
}

suspend fun BrickRepository.getMe(): Result<MeResponse> = safeCall { api.getMe() }

suspend fun BrickRepository.getCacheStats(): Result<CacheStatsResponse> = safeCall { api.getCacheStats() }

suspend fun BrickRepository.getCacheTtl(): Result<CacheTtlResponse> = safeCall { api.getCacheTtl() }

suspend fun BrickRepository.setCacheTtl(hours: Int): Result<GenericAdminResponse> = safeCall { api.setCacheTtl(mapOf("ttl" to hours.toString())) }

suspend fun BrickRepository.getApiLimits(): Result<ApiLimitsResponse> = safeCall { api.getApiLimits() }

suspend fun BrickRepository.setApiLimits(rb: Int, bl: Int, bs: Int): Result<GenericAdminResponse> = safeCall { api.setApiLimits(mapOf("rebrickable" to rb, "bricklink" to bl, "brickset" to bs)) }

suspend fun BrickRepository.getJobs(): Result<JobsResponse> = safeCall { api.getJobs() }

suspend fun BrickRepository.getBricksetQueue(): Result<BricksetQueueResponse> = safeCall { api.getBricksetQueue() }

suspend fun BrickRepository.retryBricksetEntry(setNumber: String): Result<GenericAdminResponse> = safeCall { api.retryBricksetEntry(setNumber) }

suspend fun BrickRepository.deleteBricksetEntry(setNumber: String): Result<GenericAdminResponse> = safeCall { api.deleteBricksetEntry(setNumber) }

suspend fun BrickRepository.redownloadMissingImages(): Result<GenericAdminResponse> = safeCall { api.redownloadMissingImages() }

// ── Katalog ──────────────────────────────────────────────────────────────
suspend fun BrickRepository.getCatalogMeta(): Result<CatalogMetaResponse> =
    cached("catalog-meta", CatalogMetaResponse.serializer()) { safeCall { api.getCatalogMeta() } }

suspend fun BrickRepository.getCatalogSets(
    q: String? = null, themeId: Int? = null, yearFrom: Int? = null, yearTo: Int? = null,
    sort: String = "year_desc", page: Int = 1, limit: Int = 60
): Result<CatalogSetsResponse> = safeCall { api.getCatalogSets(q, themeId, yearFrom, yearTo, sort, page, limit) }

/** Sprungziel des Jahres-Scrubbers — gerechnet mit denselben Filtern wie die Liste. */
suspend fun BrickRepository.getCatalogYearOffset(
    year: Int, q: String? = null, themeId: Int? = null,
    sort: String = "year_desc", limit: Int = CATALOG_PAGE_SIZE
): Result<ch.brickinventoryapp.data.model.CatalogYearOffsetResponse> =
    safeCall { api.getCatalogYearOffset(year, q, themeId, sort, limit) }

suspend fun BrickRepository.getCatalogSetDetail(setNumber: String): Result<CatalogSetDetailResponse> =
    safeCall { api.getCatalogSetDetail(setNumber) }
