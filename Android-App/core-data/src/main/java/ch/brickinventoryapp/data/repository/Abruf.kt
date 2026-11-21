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
 * What the repositories need in common, as functions instead of a base class:
 * a repository gets the store only if it has an offline stock. A
 * default in the constructor would silently give the others a store whose outbox is never
 * sent.
 */

/**
 * Fetch a list from the server and take it over into the local store; if the
 * server is unreachable, it comes from the store, including its state. Replaces the
 * JSON disk cache for everything that can be edited offline.
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
        // If something is still waiting in the outbox, it already lies above the server response locally.
        if (!wartet(fach.art)) return frisch
        return Ergebnis.Erfolg(fromLocal(lies(fach)?.liste.orEmpty()))
    }
    if (frisch !is Ergebnis.Fehler || !frisch.transient) return frisch
    val lokal = lies(fach) ?: return frisch
    val stand = lokal.stand ?: return frisch
    return Ergebnis.Erfolg(fromLocal(lokal.liste), stand = stand)
}

/**
 * Fetch a paging list completely into the store, page by page; the store
 * is shown. Writing happens only after the last page, otherwise the list would shrink
 * to page 1 in between; if the account changes meanwhile, nothing is stored.
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

/** All pages of a paging response, each with the [retry]; for duplicate keys the later one wins. */
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

/** Upper limit for [allPages] in case the server names a wrong total. */
private const val MAX_PAGES = 500

/**
 * Writing with an outbox: online directly; without a connection — or if something
 * is already waiting, so that the order holds — into the outbox and applied
 * locally. Then the result is [Ergebnis.Erfolg.gepuffert] with [ersatz].
 * The direct attempt and the buffered one carry the same Idempotency-Key:
 * if the first arrived and only the response did not, the second does not act twice.
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
 * Writing that only works online: what succeeds updates the store via [effect]
 * (null = the response reports no success). The list thus stays the only
 * source; nobody has to call „please reload“ afterwards.
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

/** If the account changed during the call, the response does not belong in the new store. */
private suspend fun Offlineablage.applyInSameAreaAn(w: Wirkung, vorher: String?) {
    val b = bereich() ?: return
    if (b == vorher) applyAn(w, b)
}

/**
 * Like [reconciled], for a single response without a list (key figures, catalog metadata):
 * one row per area. The store only steps in if the server was unreachable;
 * a response from it (401, 404, 500) is its answer and is not covered up.
 */
@Suppress("UNCHECKED_CAST") // E is T or T?: what lies in the store is always an E.
internal suspend fun <T : Any, E : T?> Offlineablage.reconciledSingle(fach: Fach<T>, call: suspend () -> Ergebnis<E>): Ergebnis<E> {
    val vorher = bereich()
    val frisch = call()
    val bereich = bereich()?.takeIf { it == vorher } ?: return frisch
    if (frisch is Ergebnis.Erfolg) {
        // Without a value (a response without stats) the store stays as it is.
        frisch.data?.let { adopt(fach, listOf(it as T), bereich) }
        return frisch
    }
    if (frisch !is Ergebnis.Fehler || !frisch.transient) return frisch
    val lokal = lies(fach) ?: return frisch
    val wert = lokal.liste.firstOrNull() ?: return frisch
    return Ergebnis.Erfolg(wert as E, stand = lokal.stand ?: return frisch)
}

/**
 * A Retrofit response as Ergebnis: server message and code are kept,
 * transport errors are marked as temporary. Top-level because the
 * outbox (data/lokal) also sends with it without being a repository.
 */
@Suppress("TooGenericExceptionCaught") // The boundary: every error becomes Ergebnis here.
internal suspend fun <T> sicherAufrufen(call: suspend () -> Response<T>): Ergebnis<T> {
    return try {
        val response = call()
        if (response.isSuccessful) {
            response.body()?.let { Ergebnis.Erfolg(it) }
                ?: Ergebnis.Fehler.LeereAntwort()
        } else {
            // Sentence and code of the server: the sentence for display, the code for branching.
            // If the sentence is missing, the display formulates it by kind.
            val rumpf = fangeAusserAbbruch { Fehlerrumpf.lies(response.errorBody()?.string()) }
                .getOrElse { Fehlerrumpf(null, null) }
            val text = rumpf.text ?: ""
            val code = Fehlercode.aus(rumpf.code)
            if (response.code() == 401) Ergebnis.Fehler.Abgewiesen(text, code)
            else Ergebnis.Fehler.Server(response.code(), text, code)
        }
    } catch (e: kotlinx.coroutines.CancellationException) {
        // Cancelled coroutines (e.g. search debounce replaces request) must
        // not land in the state as "network error" — pass the cancellation on.
        throw e
    } catch (_: java.net.UnknownHostException) {
        // Network is temporary by its very kind; the retry does not have to guess it
        // from the error message.
        Ergebnis.Fehler.Netz()
    } catch (_: java.net.ConnectException) {
        Ergebnis.Fehler.Netz()
    } catch (_: java.net.SocketTimeoutException) {
        Ergebnis.Fehler.Zeitueberschreitung
    } catch (_: PlaintextRejected) {
        // Not temporary: a second attempt would go to http just the same.
        Ergebnis.Fehler.Klartext
    } catch (e: java.io.IOException) {
        // Every other IOException is a transport problem and retryable, no matter
        // which subtype OkHttp chooses. Errors when evaluating the response are
        // no IOException and pass below as Unbekannt.
        Ergebnis.Fehler.Netz(technical = e.message)
    } catch (e: Exception) {
        // e.message here is throughout English library text ("Socket
        // closed", "unexpected end of stream") — no sentence to a human,
        // hence only in the technical field for the log.
        Ergebnis.Fehler.Unbekannt(technical = e.message)
    }
}

/**
 * A success whose body [erfolg] negates becomes a refusal with the server's sentence;
 * otherwise [f]. That way no caller knows the wire format's `success` field.
 */
internal inline fun <T, R> Ergebnis<T>.promised(erfolg: (T) -> Boolean, satz: (T) -> String?, f: (T) -> R): Ergebnis<R> =
    when (this) {
        is Ergebnis.Erfolg -> if (erfolg(data)) Ergebnis.Erfolg(f(data), stand, gepuffert)
            else Ergebnis.Fehler.Absage(satz(data).orEmpty())
        is Ergebnis.Fehler -> this
    }

/** For responses without `error` in the contract: an error comes there as an HTTP error, the refusal stays without a sentence. */
internal inline fun <T, R> Ergebnis<T>.promised(erfolg: (T) -> Boolean, f: (T) -> R): Ergebnis<R> =
    promised(erfolg, { null }, f)

/** For actions whose response nobody reads. */
internal fun Ergebnis<*>.withoutContent(): Ergebnis<Unit> = shown { }

/** The usual response of a change: accepted or refused, nothing else to read. */
internal fun Ergebnis<GenericResponse>.erledigt(): Ergebnis<Unit> = promised({ it.success }) { }

/** Map the rows of a flow from the store; state and discarded rows stay. */
internal fun <T, R> Flow<Local<T>>.shown(f: (T) -> R): Flow<Local<R>> =
    map { l -> Local(l.liste.map(f), l.stand, l.verworfen) }
