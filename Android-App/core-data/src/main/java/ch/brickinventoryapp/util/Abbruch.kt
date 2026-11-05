package ch.brickinventoryapp.util

import kotlin.coroutines.cancellation.CancellationException

/**
 * Wie `runCatching`, aber das Abbrechen einer Koroutine geht weiter. Sonst liefe
 * ein abgebrochener Aufruf als gewöhnlicher Fehler weiter und hielte den Scope
 * offen. Errors (OutOfMemory u. ä.) fängt sie bewusst nicht.
 */
@Suppress("TooGenericExceptionCaught") // Die eine Stelle, an der breit gefangen wird.
inline fun <T> fangeAusserAbbruch(block: () -> T): kotlin.Result<T> =
    try {
        kotlin.Result.success(block())
    } catch (abbruch: CancellationException) {
        throw abbruch
    } catch (e: Exception) {
        kotlin.Result.failure(e)
    }
