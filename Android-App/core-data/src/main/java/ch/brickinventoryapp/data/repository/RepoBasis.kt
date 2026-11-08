package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.util.fangeAusserAbbruch
import ch.brickinventoryapp.netz.data.api.Fehlerrumpf
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Fach
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.model.data.model.*
import retrofit2.Response
import ch.brickinventoryapp.netz.util.KlartextAbgelehnt

/**
 * Was die Repositories gemeinsam brauchen: den Abruf mit Plattenspeicher als
 * Rückfallebene und die Umsetzung einer Retrofit-Antwort in ein Ergebnis. Jedes
 * Repository sieht nur seinen Bereich der Schnittstelle ([A]).
 */
abstract class RepoBasis<A : Any>(
    /** Nur der Bereich der Schnittstelle, den dieses Repository braucht (data/api/). */
    protected val api: A,
    protected val cache: ResponseCache,
    /** Room-Ablage und Ausgang. */
    protected val ablage: Offlineablage,
) {
    /** Für Bereiche ohne Offline-Bestand: Sie lesen und schreiben nur am Server. */
    constructor(api: A, cache: ResponseCache) : this(api, cache, Offlineablage.fluechtig())

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
        call: suspend () -> Ergebnis<R>,
    ): Ergebnis<R> {
        val vorher = ablage.bereich()
        val frisch = call()
        val bereich = ablage.bereich()?.takeIf { it == vorher } ?: return frisch
        if (frisch is Ergebnis.Success) {
            ablage.uebernimm(fach, liste(frisch.data), anhaengen, bereich)
            // Wartet noch etwas im Ausgang, liegt es lokal schon über der Serverantwort.
            if (!ablage.wartet(fach.art)) return frisch
            return Ergebnis.Success(ausLokal(ablage.lies(fach)?.liste.orEmpty()))
        }
        if (frisch !is Ergebnis.Error || !frisch.transient) return frisch
        val lokal = ablage.lies(fach) ?: return frisch
        val stand = lokal.stand ?: return frisch
        return Ergebnis.Success(ausLokal(lokal.liste), stand = stand)
    }

    /**
     * Schreiben mit Ausgang: online direkt; ohne Verbindung — oder wenn schon
     * etwas wartet, damit die Reihenfolge hält — in den Ausgang und lokal
     * angewandt. Dann ist das Ergebnis [Ergebnis.Success.gepuffert] mit [ersatz].
     * Der direkte Versuch und der gepufferte tragen denselben Idempotency-Key:
     * Kam der erste an und nur die Antwort nicht, wirkt der zweite nicht doppelt.
     */
    protected suspend fun <T> schreibe(
        bearbeitung: Bearbeitung,
        ersatz: () -> T,
        direkt: suspend (schluessel: String) -> Ergebnis<T>,
    ): Ergebnis<T> {
        val schluessel = ablage.neuerSchluessel()
        if (ablage.wartet() && ablage.puffere(bearbeitung, schluessel)) return Ergebnis.Success(ersatz(), gepuffert = true)
        val r = direkt(schluessel)
        if (r is Ergebnis.Error && r.transient && ablage.puffere(bearbeitung, schluessel))
            return Ergebnis.Success(ersatz(), gepuffert = true)
        if (r is Ergebnis.Success) ablage.wendeAn(bearbeitung)
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
        call: suspend () -> Ergebnis<T>,
    ): Ergebnis<T> {
        // Abgelegt und gelesen wird nur, wenn vor und nach dem Abruf derselbe
        // Bereich gilt. Wechselt das Konto während des Abrufs, gehört die
        // Antwort keinem der beiden sicher.
        val vorher = cache.bereich()
        val fresh = call()
        val bereich = cache.bereich()?.takeIf { it == vorher } ?: return fresh
        if (fresh is Ergebnis.Success) {
            cache.put(bereich, key, serializer, fresh.data)
            return fresh
        }
        // Die Platte springt nur ein, wenn der Server NICHT erreichbar war
        // (transient: Verbindung, Zeitüberschreitung). Antwortet er mit 401, 404
        // oder 500, ist das seine Auskunft — alte Daten darüber zu legen hiesse,
        // sie zu verschweigen. Der Rückfall trägt seinen Stand, damit die Liste
        // „Offline – Stand von …“ zeigen kann statt frisch auszusehen.
        if (fresh !is Ergebnis.Error || !fresh.transient) return fresh
        val (stored, stand) = cache.getMitStand(bereich, key, serializer) ?: return fresh
        return Ergebnis.Success(stored, stand = stand)
    }

    protected suspend fun <T> safeCall(call: suspend () -> Response<T>): Ergebnis<T> = sicherAufrufen(call)
}

/**
 * Eine Retrofit-Antwort als Ergebnis: Servermeldung und -code bleiben erhalten,
 * Transportfehler sind als vorübergehend markiert. Top-Level, weil auch der
 * Ausgang (data/lokal) damit sendet, ohne ein Repository zu sein.
 */
@Suppress("TooGenericExceptionCaught") // Die Grenze: jeder Fehler wird hier zu Ergebnis.
suspend fun <T> sicherAufrufen(call: suspend () -> Response<T>): Ergebnis<T> {
    return try {
        val response = call()
        if (response.isSuccessful) {
            response.body()?.let { Ergebnis.Success(it) }
                ?: Ergebnis.Error.LeereAntwort()
        } else {
            // Satz und Code des Servers: der Satz zum Anzeigen, der Code zum Verzweigen.
            // Fehlt der Satz, formuliert die Anzeige ihn nach der Art.
            val rumpf = fangeAusserAbbruch { Fehlerrumpf.lies(response.errorBody()?.string()) }
                .getOrElse { Fehlerrumpf(null, null) }
            val text = rumpf.text ?: ""
            val code = Fehlercode.aus(rumpf.code)
            if (response.code() == 401) Ergebnis.Error.Abgewiesen(text, code)
            else Ergebnis.Error.Server(response.code(), text, code)
        }
    } catch (e: kotlinx.coroutines.CancellationException) {
        // Abgebrochene Coroutines (z.B. Suche-Debounce ersetzt Request) dürfen
        // nicht als "Netzwerkfehler" im State landen — Cancellation weiterreichen.
        throw e
    } catch (_: java.net.UnknownHostException) {
        // Netz ist vorübergehend schon nach seiner Art; retryOnNetwork muss es nicht
        // an der Fehlermeldung erraten.
        Ergebnis.Error.Netz()
    } catch (_: java.net.ConnectException) {
        Ergebnis.Error.Netz()
    } catch (_: java.net.SocketTimeoutException) {
        Ergebnis.Error.Zeitueberschreitung
    } catch (_: KlartextAbgelehnt) {
        // Nicht vorübergehend: Ein zweiter Versuch ginge genauso an http.
        Ergebnis.Error.Klartext
    } catch (e: java.io.IOException) {
        // Jede übrige IOException ist ein Transportproblem und wiederholbar, gleich
        // welchen Untertyp OkHttp wählt. Fehler beim Auswerten der Antwort sind
        // keine IOException und laufen unten als Unbekannt durch.
        Ergebnis.Error.Netz(technisch = e.message)
    } catch (e: Exception) {
        // e.message ist hier durchweg englischer Bibliothekstext ("Socket
        // closed", "unexpected end of stream"). Als Meldung an den Nutzer
        // war das nie sinnvoll; sie steht jetzt im Log-Feld statt im Satz.
        Ergebnis.Error.Unbekannt(technisch = e.message)
    }
}
