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
 * Was alle Teil-Repositories gemeinsam brauchen.
 *
 * ── Warum es diese Klasse gibt (Nachtrag 155) ───────────────────────────────
 *
 * BrickRepository hatte 78 oeffentliche Funktionen in 519 Zeilen und war die
 * Anlaufstelle fuer Sets, Teile, Minifiguren, Finanzen, Haushalt, Katalog und
 * Betrieb zugleich. Aufgeteilt ist sie jetzt in fuenf Klassen nach
 * Sachgebieten; was sie teilen, steht hier.
 *
 * Nur zwei Dinge sind gemeinsam, und beide sind reine Mechanik: der Abruf mit
 * Plattenspeicher als Rueckfallebene und die Umsetzung einer Retrofit-Antwort
 * in ein Result. Keine der 78 Funktionen ruft eine andere auf — nachgeprueft,
 * null Stellen —, deshalb laesst sich entlang der Sachgebiete schneiden, ohne
 * dass etwas auseinandergerissen wird.
 *
 * `protected` statt `private`: Die Unterklassen brauchen beides, sonst
 * niemand.
 */
abstract class RepoBasis(
    protected val api: BrickApiService,
    protected val cache: ResponseCache,
) {

    /**
     * Netzabruf mit Plattenspeicher als Rückfallebene.
     *
     * Reihenfolge ist bewusst „erst Netz, dann Cache": Der Server bleibt die
     * Wahrheit, der Cache springt nur ein, wenn der Abruf scheitert. Ein
     * Cache-First-Ansatz würde frische Daten verdrängen.
     *
     * Nutzen: Nach einem Neustart ohne Netz — oder bei langsamer Verbindung —
     * ist die App gefüllt statt leer. Bisher lud sie bei jedem Öffnen alles neu
     * und blieb offline vollständig unbrauchbar.
     */
    protected suspend fun <T : Any> cached(
        key: String,
        serializer: kotlinx.serialization.KSerializer<T>,
        call: suspend () -> Result<T>,
    ): Result<T> {
        val fresh = call()
        if (fresh is Result.Success) {
            cache.put(key, serializer, fresh.data)
            return fresh
        }
        // Eine abgelaufene Sitzung darf nicht durch bis zu 7 Tage alte
        // Plattendaten verdeckt werden — sonst sieht der Nutzer eine scheinbar
        // normale Galerie, obwohl er längst ausgeloggt ist (siehe logout() in
        // SessionFeature.kt, das per SessionExpiredSignal ausgelöst wird).
        if (fresh is Result.Error && fresh.unauthorized) return fresh
        val stored = cache.get(key, serializer)
        return if (stored != null) Result.Success(stored) else fresh
    }

    protected suspend fun <T> safeCall(call: suspend () -> Response<T>): Result<T> {
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
}
