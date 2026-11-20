package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.Flow
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.network.data.api.Fehlerrumpf
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.Fach
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.Offlineablage.Wirkung
import ch.brickinventoryapp.model.domain.Fehlercode
import retrofit2.Response
import ch.brickinventoryapp.network.util.PlaintextRejected

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
internal suspend fun <R, T : Any> Offlineablage.reconciled(
    fach: Fach<T>,
    liste: (R) -> List<T>,
    fromLocal: (List<T>) -> R,
    call: suspend () -> Ergebnis<R>,
): Ergebnis<R> {
    val vorher = bereich()
    val frisch = call()
    val bereich = bereich()?.takeIf { it == vorher } ?: return frisch
    if (frisch is Ergebnis.Erfolg) {
        adopt(fach, liste(frisch.data), bereich)
        // Wartet noch etwas im Ausgang, liegt es lokal schon über der Serverantwort.
        if (!wartet(fach.art)) return frisch
        return Ergebnis.Erfolg(fromLocal(lies(fach)?.liste.orEmpty()))
    }
    if (frisch !is Ergebnis.Fehler || !frisch.transient) return frisch
    val lokal = lies(fach) ?: return frisch
    val stand = lokal.stand ?: return frisch
    return Ergebnis.Erfolg(fromLocal(lokal.liste), stand = stand)
}

/**
 * Eine blätternde Liste ganz in die Ablage holen, Seite für Seite; gezeigt wird die
 * Ablage. Geschrieben wird erst nach der letzten Seite, sonst schrumpfte die Liste
 * zwischendurch auf Seite 1; wechselt dabei das Konto, wird nichts abgelegt.
 */
internal suspend fun <R, T : Any> Offlineablage.refreshPaged(
    fach: Fach<T>,
    liste: (R) -> List<T>,
    gesamt: (R) -> Int,
    retry: Wiederholung,
    seite: suspend (nummer: Int) -> Ergebnis<R>,
): Ergebnis<Unit> {
    val vorher = bereich() ?: return Ergebnis.Erfolg(Unit)
    val r = allPages(liste, fach.schluessel, gesamt, retry, seite)
    if (r is Ergebnis.Fehler) return r
    if (bereich() == vorher) adopt(fach, (r as Ergebnis.Erfolg).data, bereich = vorher)
    return Ergebnis.Erfolg(Unit)
}

/** Alle Seiten einer blätternden Antwort, jede mit der [retry]; doppelte Schlüssel gewinnt die spätere. */
internal suspend fun <R, T> allPages(
    liste: (R) -> List<T>,
    schluessel: (T) -> String,
    gesamt: (R) -> Int,
    retry: Wiederholung,
    seite: suspend (nummer: Int) -> Ergebnis<R>,
): Ergebnis<List<T>> {
    val alle = LinkedHashMap<String, T>()
    for (nummer in 1..MAX_PAGES) {
        val r = retry.wiederhole { seite(nummer) }
        if (r is Ergebnis.Fehler) return r
        val antwort = (r as Ergebnis.Erfolg).data
        val neu = liste(antwort)
        neu.forEach { alle[schluessel(it)] = it }
        if (neu.isEmpty() || alle.size >= gesamt(antwort)) break
    }
    return Ergebnis.Erfolg(alle.values.toList())
}

/** Obergrenze für [allPages], falls der Server eine falsche Gesamtzahl nennt. */
private const val MAX_PAGES = 500

/**
 * Schreiben mit Ausgang: online direkt; ohne Verbindung — oder wenn schon
 * etwas wartet, damit die Reihenfolge hält — in den Ausgang und lokal
 * angewandt. Dann ist das Ergebnis [Ergebnis.Erfolg.gepuffert] mit [ersatz].
 * Der direkte Versuch und der gepufferte tragen denselben Idempotency-Key:
 * Kam der erste an und nur die Antwort nicht, wirkt der zweite nicht doppelt.
 */
internal suspend fun <T> Offlineablage.schreibe(
    bearbeitung: Editing,
    ersatz: () -> T,
    direkt: suspend (schluessel: String) -> Ergebnis<T>,
): Ergebnis<T> {
    val schluessel = newKey()
    if (wartet() && buffer(bearbeitung, schluessel)) return Ergebnis.Erfolg(ersatz(), gepuffert = true)
    val vorher = bereich()
    val r = direkt(schluessel)
    if (r is Ergebnis.Fehler && r.transient && buffer(bearbeitung, schluessel))
        return Ergebnis.Erfolg(ersatz(), gepuffert = true)
    if (r is Ergebnis.Erfolg) applyInSameAreaAn(bearbeitung, vorher)
    return r
}

/**
 * Schreiben, das nur online geht: Was gelingt, zieht die Ablage über [effect]
 * nach (null = die Antwort meldet keinen Erfolg). Die Liste bleibt so die einzige
 * Quelle; niemand muss danach „bitte neu laden“ rufen.
 */
internal suspend fun <T> Offlineablage.nachgezogen(
    effect: (T) -> Wirkung?,
    call: suspend () -> Ergebnis<T>,
): Ergebnis<T> {
    val vorher = bereich()
    val r = call()
    if (r is Ergebnis.Erfolg) effect(r.data)?.let { applyInSameAreaAn(it, vorher) }
    return r
}

/** Wechselte das Konto während des Aufrufs, gehört die Antwort nicht in die neue Ablage. */
private suspend fun Offlineablage.applyInSameAreaAn(w: Wirkung, vorher: String?) {
    val b = bereich() ?: return
    if (b == vorher) applyAn(w, b)
}

/**
 * Wie [reconciled], für eine einzelne Antwort ohne Liste (Kennzahlen, Katalog-Metadaten):
 * eine Zeile je Bereich. Die Ablage springt nur ein, wenn der Server nicht erreichbar war;
 * eine Antwort von ihm (401, 404, 500) ist seine Auskunft und wird nicht überdeckt.
 */
@Suppress("UNCHECKED_CAST") // E ist T oder T?: Was in der Ablage liegt, ist immer ein E.
internal suspend fun <T : Any, E : T?> Offlineablage.reconciledSingle(fach: Fach<T>, call: suspend () -> Ergebnis<E>): Ergebnis<E> {
    val vorher = bereich()
    val frisch = call()
    val bereich = bereich()?.takeIf { it == vorher } ?: return frisch
    if (frisch is Ergebnis.Erfolg) {
        // Ohne Wert (eine Antwort ohne stats) bleibt die Ablage, wie sie ist.
        frisch.data?.let { adopt(fach, listOf(it as T), bereich) }
        return frisch
    }
    if (frisch !is Ergebnis.Fehler || !frisch.transient) return frisch
    val lokal = lies(fach) ?: return frisch
    val wert = lokal.liste.firstOrNull() ?: return frisch
    return Ergebnis.Erfolg(wert as E, stand = lokal.stand ?: return frisch)
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
            response.body()?.let { Ergebnis.Erfolg(it) }
                ?: Ergebnis.Fehler.LeereAntwort()
        } else {
            // Satz und Code des Servers: der Satz zum Anzeigen, der Code zum Verzweigen.
            // Fehlt der Satz, formuliert die Anzeige ihn nach der Art.
            val rumpf = fangeAusserAbbruch { Fehlerrumpf.lies(response.errorBody()?.string()) }
                .getOrElse { Fehlerrumpf(null, null) }
            val text = rumpf.text ?: ""
            val code = Fehlercode.aus(rumpf.code)
            if (response.code() == 401) Ergebnis.Fehler.Abgewiesen(text, code)
            else Ergebnis.Fehler.Server(response.code(), text, code)
        }
    } catch (e: kotlinx.coroutines.CancellationException) {
        // Abgebrochene Coroutines (z.B. Suche-Debounce ersetzt Request) dürfen
        // nicht als "Netzwerkfehler" im State landen — Cancellation weiterreichen.
        throw e
    } catch (_: java.net.UnknownHostException) {
        // Netz ist vorübergehend schon nach seiner Art; die Wiederholung muss es nicht
        // an der Fehlermeldung erraten.
        Ergebnis.Fehler.Netz()
    } catch (_: java.net.ConnectException) {
        Ergebnis.Fehler.Netz()
    } catch (_: java.net.SocketTimeoutException) {
        Ergebnis.Fehler.Zeitueberschreitung
    } catch (_: PlaintextRejected) {
        // Nicht vorübergehend: Ein zweiter Versuch ginge genauso an http.
        Ergebnis.Fehler.Klartext
    } catch (e: java.io.IOException) {
        // Jede übrige IOException ist ein Transportproblem und wiederholbar, gleich
        // welchen Untertyp OkHttp wählt. Fehler beim Auswerten der Antwort sind
        // keine IOException und laufen unten als Unbekannt durch.
        Ergebnis.Fehler.Netz(technical = e.message)
    } catch (e: Exception) {
        // e.message ist hier durchweg englischer Bibliothekstext ("Socket
        // closed", "unexpected end of stream") — kein Satz an einen Menschen,
        // deshalb nur im technischen Feld fürs Protokoll.
        Ergebnis.Fehler.Unbekannt(technical = e.message)
    }
}

/**
 * Ein Erfolg, dessen Rumpf [erfolg] verneint, wird zur Absage mit dem Satz des Servers;
 * sonst [f]. So kennt kein Aufrufer das `success`-Feld des Wire-Formats.
 */
internal inline fun <T, R> Ergebnis<T>.promised(erfolg: (T) -> Boolean, satz: (T) -> String?, f: (T) -> R): Ergebnis<R> =
    when (this) {
        is Ergebnis.Erfolg -> if (erfolg(data)) Ergebnis.Erfolg(f(data), stand, gepuffert)
            else Ergebnis.Fehler.Absage(satz(data).orEmpty())
        is Ergebnis.Fehler -> this
    }

/** Für Antworten ohne `error` im Vertrag: Ein Fehler kommt dort als HTTP-Fehler, die Absage bleibt ohne Satz. */
internal inline fun <T, R> Ergebnis<T>.promised(erfolg: (T) -> Boolean, f: (T) -> R): Ergebnis<R> =
    promised(erfolg, { null }, f)

/** Für Aktionen, deren Antwort niemand liest. */
internal fun Ergebnis<*>.withoutContent(): Ergebnis<Unit> = shown { }

/** Die übliche Antwort einer Änderung: zugesagt oder abgesagt, sonst nichts zu lesen. */
internal fun Ergebnis<GenericResponse>.erledigt(): Ergebnis<Unit> = promised({ it.success }) { }

/** Die Zeilen eines Flusses aus der Ablage abbilden; Stand und verworfene Zeilen bleiben. */
internal fun <T, R> Flow<Local<T>>.shown(f: (T) -> R): Flow<Local<R>> =
    map { l -> Local(l.liste.map(f), l.stand, l.verworfen) }
