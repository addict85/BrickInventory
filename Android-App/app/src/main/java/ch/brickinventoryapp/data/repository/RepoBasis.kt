package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.Fehlerrumpf
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Fach
import ch.brickinventoryapp.data.lokal.Offlineablage
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
 * Was die Repositories gemeinsam brauchen: den Abruf mit Plattenspeicher als
 * Rückfallebene und die Umsetzung einer Retrofit-Antwort in ein Result. Jedes
 * Repository sieht nur seinen Bereich der Schnittstelle ([A]).
 */
abstract class RepoBasis<A : Any>(
    /** Nur der Bereich der Schnittstelle, den dieses Repository braucht (data/api/). */
    protected val api: A,
    protected val cache: ResponseCache,
    /** Room-Ablage und Ausgang; ohne Hilt eine flüchtige im Speicher. */
    protected val ablage: Offlineablage = Offlineablage.fluechtig(),
) {

    /**
     * Eine Liste vom Server holen und in die lokale Ablage übernehmen; ist der
     * Server nicht erreichbar, kommt sie aus der Ablage, samt Stand. Ersetzt den
     * JSON-Plattenspeicher für alles, was offline bearbeitet werden kann.
     */
    protected suspend fun <R, T : Any> abgeglichen(
        fach: Fach<T>,
        liste: (R) -> List<T>,
        ausLokal: (List<T>) -> R,
        anhaengen: Boolean = false,
        call: suspend () -> Result<R>,
    ): Result<R> {
        val vorher = ablage.bereich()
        val frisch = call()
        val bereich = ablage.bereich()?.takeIf { it == vorher } ?: return frisch
        if (frisch is Result.Success) {
            ablage.uebernimm(fach, liste(frisch.data), anhaengen, bereich)
            // Wartet noch etwas im Ausgang, liegt es lokal schon über der Serverantwort.
            if (!ablage.wartet(fach.art)) return frisch
            return Result.Success(ausLokal(ablage.lies(fach)?.liste.orEmpty()))
        }
        if (frisch !is Result.Error || !frisch.transient) return frisch
        val lokal = ablage.lies(fach) ?: return frisch
        val stand = lokal.stand ?: return frisch
        return Result.Success(ausLokal(lokal.liste), stand = stand)
    }

    /**
     * Schreiben mit Ausgang: online direkt; ohne Verbindung — oder wenn schon
     * etwas wartet, damit die Reihenfolge hält — in den Ausgang und lokal
     * angewandt. Dann ist das Ergebnis [Result.Success.gepuffert] mit [ersatz].
     */
    protected suspend fun <T> schreibe(
        bearbeitung: Bearbeitung,
        ersatz: () -> T,
        direkt: suspend () -> Result<T>,
    ): Result<T> {
        if (ablage.wartet() && ablage.puffere(bearbeitung)) return Result.Success(ersatz(), gepuffert = true)
        val r = direkt()
        if (r is Result.Error && r.transient && ablage.puffere(bearbeitung))
            return Result.Success(ersatz(), gepuffert = true)
        if (r is Result.Success) ablage.wendeAn(bearbeitung)
        return r
    }

    /**
     * Netzabruf mit Plattenspeicher als Rückfallebene. Erst Netz, dann Cache: Der
     * Server bleibt die Wahrheit, der Cache springt nur ein, wenn er nicht erreichbar
     * ist — Cache-First verdrängte frische Daten. So ist die App nach einem Neustart
     * ohne Netz oder bei langsamer Verbindung gefüllt statt leer.
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

    protected suspend fun <T> safeCall(call: suspend () -> Response<T>): Result<T> = sicherAufrufen(call)
}

/**
 * Eine Retrofit-Antwort als Result: Servermeldung und -code bleiben erhalten,
 * Transportfehler sind als vorübergehend markiert. Top-Level, weil auch der
 * Ausgang (data/lokal) damit sendet, ohne ein Repository zu sein.
 */
suspend fun <T> sicherAufrufen(call: suspend () -> Response<T>): Result<T> {
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
        // Jede übrige IOException ist ein Transportproblem und wiederholbar, gleich
        // welchen Untertyp OkHttp wählt. Fehler beim Auswerten der Antwort sind
        // keine IOException und laufen unten als UNBEKANNT durch.
        Result.Error("", transient = true, art = Fehlerart.NETZ, technisch = e.message)
    } catch (e: Exception) {
        // e.message ist hier durchweg englischer Bibliothekstext ("Socket
        // closed", "unexpected end of stream"). Als Meldung an den Nutzer
        // war das nie sinnvoll; sie steht jetzt im Log-Feld statt im Satz.
        Result.Error("", art = Fehlerart.UNBEKANNT, technisch = e.message)
    }
}
