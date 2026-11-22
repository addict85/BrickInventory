package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.model.domain.ErrorCode
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.network.data.api.ErrorBody
import ch.brickinventoryapp.network.util.PlaintextRejected
import ch.brickinventoryapp.offline.Domain
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OfflineStore.Effect
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import retrofit2.Response

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
internal suspend fun <R, T : Any> OfflineStore.reconciled(
    domain: Domain<T>,
    list: (R) -> List<T>,
    fromLocal: (List<T>) -> R,
    call: suspend () -> Outcome<R>,
): Outcome<R> {
    val before = area()
    val fresh = call()
    val area = area()?.takeIf { it == before } ?: return fresh
    if (fresh is Outcome.Success) {
        adopt(domain, list(fresh.data), area)
        // If something is still waiting in the outbox, it already lies above the server response locally.
        if (!waiting(domain.kind)) return fresh
        return Outcome.Success(fromLocal(read(domain)?.list.orEmpty()))
    }
    if (fresh !is Outcome.Failure || !fresh.transient) return fresh
    val local = read(domain) ?: return fresh
    val state = local.state ?: return fresh
    return Outcome.Success(fromLocal(local.list), state = state)
}

/**
 * Fetch a paging list completely into the store, page by page; the store
 * is shown. Writing happens only after the last page, otherwise the list would shrink
 * to page 1 in between; if the account changes meanwhile, nothing is stored.
 */
internal suspend fun <R, T : Any> OfflineStore.refreshPaged(
    domain: Domain<T>,
    list: (R) -> List<T>,
    total: (R) -> Int,
    retry: RetryPolicy,
    page: suspend (number: Int) -> Outcome<R>,
): Outcome<Unit> {
    val before = area() ?: return Outcome.Success(Unit)
    val r = allPages(list, domain.key, total, retry, page)
    if (r is Outcome.Failure) return r
    if (area() == before) adopt(domain, (r as Outcome.Success).data, area = before)
    return Outcome.Success(Unit)
}

/** All pages of a paging response, each with the [retry]; for duplicate keys the later one wins. */
internal suspend fun <R, T> allPages(
    list: (R) -> List<T>,
    key: (T) -> String,
    total: (R) -> Int,
    retry: RetryPolicy,
    page: suspend (number: Int) -> Outcome<R>,
): Outcome<List<T>> {
    val all = LinkedHashMap<String, T>()
    for (number in 1..MAX_PAGES) {
        val r = retry.retry { page(number) }
        if (r is Outcome.Failure) return r
        val response = (r as Outcome.Success).data
        val newValue = list(response)
        newValue.forEach { all[key(it)] = it }
        if (newValue.isEmpty() || all.size >= total(response)) break
    }
    return Outcome.Success(all.values.toList())
}

/** Upper limit for [allPages] in case the server names a wrong total. */
private const val MAX_PAGES = 500

/**
 * Writing with an outbox: online directly; without a connection — or if something
 * is already waiting, so that the order holds — into the outbox and applied
 * locally. Then the result is [Outcome.Success.buffered] with [spare].
 * The direct attempt and the buffered one carry the same Idempotency-Key:
 * if the first arrived and only the response did not, the second does not act twice.
 */
internal suspend fun <T> OfflineStore.write(
    editing: Editing,
    spare: () -> T,
    direct: suspend (key: String) -> Outcome<T>,
): Outcome<T> {
    val key = newKey()
    if (waiting() && buffer(editing, key)) return Outcome.Success(spare(), buffered = true)
    val before = area()
    val r = direct(key)
    if (r is Outcome.Failure && r.transient && buffer(editing, key))
        return Outcome.Success(spare(), buffered = true)
    if (r is Outcome.Success) applyInSameArea(editing, before)
    return r
}

/**
 * Writing that only works online: what succeeds updates the store via [effect]
 * (null = the response reports no success). The list thus stays the only
 * source; nobody has to call „please reload“ afterwards.
 */
internal suspend fun <T> OfflineStore.caughtUp(
    effect: (T) -> Effect?,
    call: suspend () -> Outcome<T>,
): Outcome<T> {
    val before = area()
    val r = call()
    if (r is Outcome.Success) effect(r.data)?.let { applyInSameArea(it, before) }
    return r
}

/** If the account changed during the call, the response does not belong in the new store. */
private suspend fun OfflineStore.applyInSameArea(w: Effect, before: String?) {
    val b = area() ?: return
    if (b == before) applyChange(w, b)
}

/**
 * Like [reconciled], for a single response without a list (key figures, catalog metadata):
 * one row per area. The store only steps in if the server was unreachable;
 * a response from it (401, 404, 500) is its answer and is not covered up.
 */
@Suppress("UNCHECKED_CAST") // E is T or T?: what lies in the store is always an E.
internal suspend fun <T : Any, E : T?> OfflineStore.reconciledSingle(domain: Domain<T>, call: suspend () -> Outcome<E>): Outcome<E> {
    val before = area()
    val fresh = call()
    val area = area()?.takeIf { it == before } ?: return fresh
    if (fresh is Outcome.Success) {
        // Without a value (a response without stats) the store stays as it is.
        fresh.data?.let { adopt(domain, listOf(it as T), area) }
        return fresh
    }
    if (fresh !is Outcome.Failure || !fresh.transient) return fresh
    val local = read(domain) ?: return fresh
    val value = local.list.firstOrNull() ?: return fresh
    return Outcome.Success(value as E, state = local.state ?: return fresh)
}

/**
 * A Retrofit response as Ergebnis: server message and code are kept,
 * transport errors are marked as temporary. Top-level because the
 * outbox (data/local) also sends with it without being a repository.
 */
@Suppress("TooGenericExceptionCaught") // The boundary: every error becomes Ergebnis here.
internal suspend fun <T> safeCall(call: suspend () -> Response<T>): Outcome<T> {
    return try {
        val response = call()
        if (response.isSuccessful) {
            response.body()?.let { Outcome.Success(it) }
                ?: Outcome.Failure.EmptyResponse()
        } else {
            // Sentence and code of the server: the sentence for display, the code for branching.
            // If the sentence is missing, the display formulates it by kind.
            val body = catchUnlessCancelled { ErrorBody.read(response.errorBody()?.string()) }
                .getOrElse { ErrorBody(null, null) }
            val text = body.text ?: ""
            val code = ErrorCode.from(body.code)
            if (response.code() == 401) Outcome.Failure.Rejected(text, code)
            else Outcome.Failure.Server(response.code(), text, code)
        }
    } catch (e: kotlinx.coroutines.CancellationException) {
        // Cancelled coroutines (e.g. search debounce replaces request) must
        // not land in the state as "network error" — pass the cancellation on.
        throw e
    } catch (_: java.net.UnknownHostException) {
        // Network is temporary by its very kind; the retry does not have to guess it
        // from the error message.
        Outcome.Failure.Network()
    } catch (_: java.net.ConnectException) {
        Outcome.Failure.Network()
    } catch (_: java.net.SocketTimeoutException) {
        Outcome.Failure.Timeout
    } catch (_: PlaintextRejected) {
        // Not temporary: a second attempt would go to http just the same.
        Outcome.Failure.Plaintext
    } catch (e: java.io.IOException) {
        // Every other IOException is a transport problem and retryable, no matter
        // which subtype OkHttp chooses. Errors when evaluating the response are
        // no IOException and pass below as Unbekannt.
        Outcome.Failure.Network(technical = e.message)
    } catch (e: Exception) {
        // e.message here is throughout English library text ("Socket
        // closed", "unexpected end of stream") — no sentence to a human,
        // hence only in the technical field for the log.
        Outcome.Failure.Unknown(technical = e.message)
    }
}

/**
 * A success whose body [success] negates becomes a refusal with the server's sentence;
 * otherwise [f]. That way no caller knows the wire format's `success` field.
 */
internal inline fun <T, R> Outcome<T>.promised(success: (T) -> Boolean, sentence: (T) -> String?, f: (T) -> R): Outcome<R> =
    when (this) {
        is Outcome.Success -> if (success(data)) Outcome.Success(f(data), state, buffered)
            else Outcome.Failure.Refusal(sentence(data).orEmpty())
        is Outcome.Failure -> this
    }

/** For responses without `error` in the contract: an error comes there as an HTTP error, the refusal stays without a sentence. */
internal inline fun <T, R> Outcome<T>.promised(success: (T) -> Boolean, f: (T) -> R): Outcome<R> =
    promised(success, { null }, f)

/** For actions whose response nobody reads. */
internal fun Outcome<*>.withoutContent(): Outcome<Unit> = mapData { }

/** The usual response of a change: accepted or refused, nothing else to read. */
internal fun Outcome<GenericResponse>.done(): Outcome<Unit> = promised({ it.success }) { }

/** Map the rows of a flow from the store; state and discarded rows stay. */
internal fun <T, R> Flow<Local<T>>.mapData(f: (T) -> R): Flow<Local<R>> =
    map { l -> Local(l.list.map(f), l.state, l.discarded) }
