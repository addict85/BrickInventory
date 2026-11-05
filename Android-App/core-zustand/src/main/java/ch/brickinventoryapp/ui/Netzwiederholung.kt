package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.repository.Result

/**
 * Wiederholen, solange der Fehler vorübergehend ist.
 * Ausführlich: docs/begruendungen/core-zustand/ui/Netzwiederholung.kt.md#retryonnetwork
 */
suspend fun <T> retryOnNetwork(
    maxAttempts: Int = 10,
    delayMs: Long = 2000,
    call: suspend () -> Result<T>
): Result<T> {
    var attempts = 0
    while (true) {
        val r = call()
        if (r is Result.Error) {
            if (r.transient && attempts < maxAttempts - 1) {
                attempts++
                kotlinx.coroutines.delay(delayMs)
                continue
            }
        }
        return r
    }
}
