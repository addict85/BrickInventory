package ch.brickinventoryapp.model.util

import kotlin.coroutines.cancellation.CancellationException

/**
 * Like `runCatching`, but the cancellation of a coroutine propagates. Otherwise
 * a cancelled call would continue as an ordinary error and keep the scope
 * open. Errors (OutOfMemory etc.) it deliberately does not catch.
 */
@Suppress("TooGenericExceptionCaught") // The one place where catching is broad.
inline fun <T> fangeAusserAbbruch(block: () -> T): kotlin.Result<T> =
    try {
        kotlin.Result.success(block())
    } catch (abort: CancellationException) {
        throw abort
    } catch (e: Exception) {
        kotlin.Result.failure(e)
    }
