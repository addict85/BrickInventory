package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.netz.data.api.Fehlerrumpf
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Fach
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.Offlineablage.Wirkung
import ch.brickinventoryapp.model.data.model.Fehlercode
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
    call: suspend () -> Ergebnis<R>,
): Ergebnis<R> {
    val vorher = bereich()
    val frisch = call()
    val bereich = bereich()?.takeIf { it == vorher } ?: return frisch
    if (frisch is Ergebnis.Success) {
        uebernimm(fach, liste(frisch.data), bereich)
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
    wiederholung: Wiederholung,
    seite: suspend (nummer: Int) -> Ergebnis<R>,
): Ergebnis<Unit> {
    val vorher = bereich() ?: return Ergebnis.Success(Unit)
    val r = alleSeiten(liste, fach.schluessel, gesamt, wiederholung, seite)
    if (r is Ergebnis.Error) return r
    if (bereich() == vorher) uebernimm(fach, (r as Ergebnis.Success).data, bereich = vorher)
    return Ergebnis.Success(Unit)
}

/** Alle Seiten einer blätternden Antwort, jede mit der [wiederholung]; doppelte Schlüssel gewinnt die spätere. */
internal suspend fun <R, T> alleSeiten(
    liste: (R) -> List<T>,
    schluessel: (T) -> String,
    gesamt: (R) -> Int,
    wiederholung: Wiederholung,
    seite: suspend (nummer: Int) -> Ergebnis<R>,
): Ergebnis<List<T>> {
    val alle = LinkedHashMap<String, T>()
    for (nummer in 1..MAX_SEITEN) {
        val r = wiederholung.wiederhole { seite(nummer) }
        if (r is Ergebnis.Error) return r
        val antwort = (r as Ergebnis.Success).data
        val neu = liste(antwort)
        neu.forEach { alle[schluessel(it)] = it }
        if (neu.isEmpty() || alle.size >= gesamt(antwort)) break
    }
    return Ergebnis.Success(alle.values.toList())
}

/** Obergrenze für [alleSeiten], falls der Server eine falsche Gesamtzahl nennt. */
private const val MAX_SEITEN = 500

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
    val vorher = bereich()
    val r = direkt(schluessel)
    if (r is Ergebnis.Error && r.transient && puffere(bearbeitung, schluessel))
        return Ergebnis.Success(ersatz(), gepuffert = true)
    if (r is Ergebnis.Success) wendeImSelbenBereichAn(bearbeitung, vorher)
    return r
}

/**
 * Schreiben, das nur online geht: Was gelingt, zieht die Ablage über [wirkung]
 * nach (null = die Antwort meldet keinen Erfolg). Die Liste bleibt so die einzige
 * Quelle; niemand muss danach „bitte neu laden“ rufen.
 */
internal suspend fun <T> Offlineablage.nachgezogen(
    wirkung: (T) -> Wirkung?,
    call: suspend () -> Ergebnis<T>,
): Ergebnis<T> {
    val vorher = bereich()
    val r = call()
    if (r is Ergebnis.Success) wirkung(r.data)?.let { wendeImSelbenBereichAn(it, vorher) }
    return r
}

/** Wechselte das Konto während des Aufrufs, gehört die Antwort nicht in die neue Ablage. */
private suspend fun Offlineablage.wendeImSelbenBereichAn(w: Wirkung, vorher: String?) {
    val b = bereich() ?: return
    if (b == vorher) wendeAn(w, b)
}

/**
 * Wie [abgeglichen], für eine einzelne Antwort ohne Liste (Kennzahlen, Katalog-Metadaten):
 * eine Zeile je Bereich. Die Ablage springt nur ein, wenn der Server nicht erreichbar war;
 * eine Antwort von ihm (401, 404, 500) ist seine Auskunft und wird nicht überdeckt.
 */
internal suspend fun <T : Any> Offlineablage.abgeglichenEinzeln(fach: Fach<T>, call: suspend () -> Ergebnis<T>): Ergebnis<T> {
    val vorher = bereich()
    val frisch = call()
    val bereich = bereich()?.takeIf { it == vorher } ?: return frisch
    if (frisch is Ergebnis.Success) {
        uebernimm(fach, listOf(frisch.data), bereich)
        return frisch
    }
    if (frisch !is Ergebnis.Error || !frisch.transient) return frisch
    val lokal = lies(fach) ?: return frisch
    val wert = lokal.liste.firstOrNull() ?: return frisch
    return Ergebnis.Success(wert, stand = lokal.stand ?: return frisch)
}

/**
 * Eine Retrofit-Antwort als Ergebnis: Servermeldung und -code bleiben erhalten,
 * Transportfehler sind als vorübergehend markiert. Top-Level, weil auch der
 * Ausgang (data/lokal) damit sendet, ohne ein Repository zu sein.
 */
@Suppress("TooGenericExceptionCaught") // Die Grenze: jeder Fehler wird hier zu Ergebnis.
internal suspend fun <T> sicherAufrufen(call: suspend () -> Response<T>): Ergebnis<T> {
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
        // Netz ist vorübergehend schon nach seiner Art; die Wiederholung muss es nicht
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
