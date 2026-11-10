package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.netz.data.api.Fehlerrumpf
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Fach
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.model.data.model.Fehlercode
import kotlinx.serialization.KSerializer
import retrofit2.Response
import ch.brickinventoryapp.netz.util.KlartextAbgelehnt

/*
 * Was die Repositories gemeinsam brauchen, als Funktionen statt als Basisklasse:
 * Ein Repository bekommt die Ablage nur, wenn es einen Offline-Bestand hat. Eine
 * Vorgabe im Konstruktor gäbe den übrigen still eine Ablage, deren Ausgang nie
 * gesendet wird.
 */

/**
 * Eine Liste vom Server holen und in die lokale Ablage übernehmen; ist der
 * Server nicht erreichbar, kommt sie aus der Ablage, samt Stand. Ersetzt den
 * JSON-Plattenspeicher für alles, was offline bearbeitet werden kann.
 */
internal suspend fun <R, T : Any> Offlineablage.abgeglichen(
    fach: Fach<T>,
    liste: (R) -> List<T>,
    ausLokal: (List<T>) -> R,
    anhaengen: Boolean = false,
    call: suspend () -> Ergebnis<R>,
): Ergebnis<R> {
    val vorher = bereich()
    val frisch = call()
    val bereich = bereich()?.takeIf { it == vorher } ?: return frisch
    if (frisch is Ergebnis.Success) {
        uebernimm(fach, liste(frisch.data), anhaengen, bereich)
        // Wartet noch etwas im Ausgang, liegt es lokal schon über der Serverantwort.
        if (!wartet(fach.art)) return frisch
        return Ergebnis.Success(ausLokal(lies(fach)?.liste.orEmpty()))
    }
    if (frisch !is Ergebnis.Error || !frisch.transient) return frisch
    val lokal = lies(fach) ?: return frisch
    val stand = lokal.stand ?: return frisch
    return Ergebnis.Success(ausLokal(lokal.liste), stand = stand)
}

/**
 * Eine blätternde Liste ganz in die Ablage holen, Seite für Seite; gezeigt wird die
 * Ablage. Geschrieben wird erst nach der letzten Seite, sonst schrumpfte die Liste
 * zwischendurch auf Seite 1; wechselt dabei das Konto, wird nichts abgelegt.
 */
internal suspend fun <R, T : Any> Offlineablage.aktualisiereSeitenweise(
    fach: Fach<T>,
    liste: (R) -> List<T>,
    gesamt: (R) -> Int,
    seite: suspend (nummer: Int) -> Ergebnis<R>,
): Ergebnis<Unit> {
    val vorher = bereich() ?: return Ergebnis.Success(Unit)
    val alle = LinkedHashMap<String, T>()
    for (nummer in 1..MAX_SEITEN) {
        val r = seite(nummer)
        if (r is Ergebnis.Error) return r
        val antwort = (r as Ergebnis.Success).data
        val neu = liste(antwort)
        neu.forEach { alle[fach.schluessel(it)] = it }
        if (neu.isEmpty() || alle.size >= gesamt(antwort)) break
    }
    if (bereich() == vorher) uebernimm(fach, alle.values.toList(), bereich = vorher)
    return Ergebnis.Success(Unit)
}

/** Obergrenze für [aktualisiereSeitenweise], falls der Server eine falsche Gesamtzahl nennt. */
private const val MAX_SEITEN = 500

/**
 * Eine gefilterte Abfrage: Online antwortet der Server, abgelegt wird nichts —
 * eine Teilmenge ersetzte sonst die Liste. Ist er nicht erreichbar, beantworten
 * dieselben Filter die lokale Liste, samt Stand für „Offline – Stand von …“.
 */
internal suspend fun <R, T : Any> Offlineablage.gefiltert(
    fach: Fach<T>,
    filter: Filterspalten,
    ausLokal: (List<T>) -> R,
    call: suspend () -> Ergebnis<R>,
): Ergebnis<R> {
    val vorher = bereich()
    val frisch = call()
    if (frisch !is Ergebnis.Error || !frisch.transient) return frisch
    if (vorher == null || bereich() != vorher) return frisch
    val lokal = filtere(fach, filter) ?: return frisch
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
internal suspend fun <T> Offlineablage.schreibe(
    bearbeitung: Bearbeitung,
    ersatz: () -> T,
    direkt: suspend (schluessel: String) -> Ergebnis<T>,
): Ergebnis<T> {
    val schluessel = neuerSchluessel()
    if (wartet() && puffere(bearbeitung, schluessel)) return Ergebnis.Success(ersatz(), gepuffert = true)
    val r = direkt(schluessel)
    if (r is Ergebnis.Error && r.transient && puffere(bearbeitung, schluessel))
        return Ergebnis.Success(ersatz(), gepuffert = true)
    if (r is Ergebnis.Success) wendeAn(bearbeitung)
    return r
}

/**
 * Netzabruf mit Plattenspeicher als Rückfallebene, nur noch für einzelne
 * Antworten ohne Liste, Filter und Bearbeitung (Kennzahlen, Katalog-Metadaten):
 * Sie sind ein Wert je Bereich, keine Zeilen. Alle Listen gehen über die Ablage.
 */
internal suspend fun <T : Any> ResponseCache.cached(
    key: String,
    serializer: KSerializer<T>,
    call: suspend () -> Ergebnis<T>,
): Ergebnis<T> {
    // Abgelegt und gelesen wird nur, wenn vor und nach dem Abruf derselbe
    // Bereich gilt. Wechselt das Konto während des Abrufs, gehört die
    // Antwort keinem der beiden sicher.
    val vorher = bereich()
    val fresh = call()
    val bereich = bereich()?.takeIf { it == vorher } ?: return fresh
    if (fresh is Ergebnis.Success) {
        put(bereich, key, serializer, fresh.data)
        return fresh
    }
    // Die Platte springt nur ein, wenn der Server NICHT erreichbar war
    // (transient: Verbindung, Zeitüberschreitung). Antwortet er mit 401, 404
    // oder 500, ist das seine Auskunft — alte Daten darüber zu legen hiesse,
    // sie zu verschweigen. Der Rückfall trägt seinen Stand, damit die Liste
    // „Offline – Stand von …“ zeigen kann statt frisch auszusehen.
    if (fresh !is Ergebnis.Error || !fresh.transient) return fresh
    val (stored, stand) = getMitStand(bereich, key, serializer) ?: return fresh
    return Ergebnis.Success(stored, stand = stand)
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
        // closed", "unexpected end of stream") — kein Satz an einen Menschen,
        // deshalb nur im technischen Feld fürs Protokoll.
        Ergebnis.Error.Unbekannt(technisch = e.message)
    }
}
