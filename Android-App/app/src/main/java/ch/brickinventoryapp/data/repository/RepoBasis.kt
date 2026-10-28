package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.api.Fehlerrumpf
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
     * Wahrheit, der Cache springt nur ein, wenn er nicht erreichbar ist. Ein
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
        // Abgelegt und gelesen wird nur, wenn vor und nach dem Abruf derselbe
        // Bereich gilt. Wechselt das Konto während des Abrufs, gehört die
        // Antwort keinem der beiden sicher.
        val vorher = cache.bereich()
        val fresh = call()
        val bereich = cache.bereich()?.takeIf { it == vorher } ?: return fresh
        if (fresh is Result.Success) {
            cache.put(bereich, key, serializer, fresh.data)
            return fresh
        }
        // Die Platte springt nur ein, wenn der Server NICHT erreichbar war
        // (transient: Verbindung, Zeitüberschreitung). Antwortet er mit 401, 404
        // oder 500, ist das seine Auskunft — alte Daten darüber zu legen hiesse,
        // sie zu verschweigen. Der Rückfall trägt seinen Stand, damit die Liste
        // „Offline – Stand von …“ zeigen kann statt frisch auszusehen.
        if (fresh !is Result.Error || !fresh.transient) return fresh
        val (stored, stand) = cache.getMitStand(bereich, key, serializer) ?: return fresh
        return Result.Success(stored, stand = stand)
    }

    protected suspend fun <T> safeCall(call: suspend () -> Response<T>): Result<T> {
        return try {
            val response = call()
            if (response.isSuccessful) {
                response.body()?.let { Result.Success(it) }
                    ?: Result.Error("", art = Fehlerart.LEERE_ANTWORT)
            } else {
                // Satz und Code des Servers: der Satz zum Anzeigen, der Code zum Verzweigen.
                val rumpf = try {
                    Fehlerrumpf.lies(response.errorBody()?.string())
                } catch (_: Exception) { Fehlerrumpf(null, null) }
                // Servermeldung gewinnt, wenn es eine gibt: Sie ist genauer als
                // jede Einordnung hier. Nur wenn keine da ist, wird die Ursache
                // als Aufzählung gemeldet und die Anzeige formuliert den Satz.
                Result.Error(
                    message = rumpf.text ?: "",
                    unauthorized = response.code() == 401,
                    art = when {
                        rumpf.text != null -> null
                        response.code() == 401 -> Fehlerart.SITZUNG_ABGELAUFEN
                        else -> Fehlerart.SERVER
                    },
                    code = rumpf.code,
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
        } catch (e: java.io.IOException) {
            // ── Der Auffangzweig fuer alles, was der Transport wirft ─────────
            //
            // Die drei Zweige darueber bleiben, weil sie eine eigene Fehlerart
            // tragen (NETZ gegen ZEIT) — der Nutzer soll „keine Verbindung"
            // von „zu langsam" unterscheiden koennen.
            //
            // Dieser hier faengt den Rest. Warum er noetig wurde: Bis okhttp 4
            // kam ein ABRISS der Verbindung als ConnectException an und lief in
            // den zweiten Zweig. Unter okhttp 5 wirft derselbe Abriss einen
            // anderen Untertyp, und damit fiel er in den letzten Zweig —
            // `transient = false`, also kein Wiederholen. GEMESSEN: Genau das
            // hat „abgerissene Verbindung ist ein Netzfehler und
            // voruebergehend" rot gemacht.
            //
            // Die Aufzaehlung war das Zerbrechliche daran, nicht die Bibliothek.
            // Eine IOException IST definitionsgemaess ein Transportproblem: Sie
            // kommt aus dem Aufruf selbst oder aus dem Lesen des Rumpfes, und
            // beides ist ein Weg ueber das Netz. Dass sie wiederholbar ist,
            // haengt an dieser Eigenschaft und nicht daran, welchen Untertyp
            // eine Bibliotheksfassung gerade waehlt.
            //
            // Was NICHT hierher faellt und auch nicht soll: Fehler beim
            // Auswerten der Antwort (Serialisierung) sind keine IOException und
            // laufen weiter unten als UNBEKANNT durch — ein Wiederholen
            // brauchte dort auch nichts.
            Result.Error("", transient = true, art = Fehlerart.NETZ, technisch = e.message)
        } catch (e: Exception) {
            // e.message ist hier durchweg englischer Bibliothekstext ("Socket
            // closed", "unexpected end of stream"). Als Meldung an den Nutzer
            // war das nie sinnvoll; sie steht jetzt im Log-Feld statt im Satz.
            Result.Error("", art = Fehlerart.UNBEKANNT, technisch = e.message)
        }
    }
}
