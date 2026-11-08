package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.data.repository.Ergebnis

/**
 * Wiederholen, solange der Fehler vorübergehend ist.
 * Ausführlich: docs/begruendungen/core-zustand/zustand/ui/Netzwiederholung.kt.md#retryonnetwork
 */
suspend fun <T> retryOnNetwork(
    maxAttempts: Int = 10,
    delayMs: Long = 2000,
    call: suspend () -> Ergebnis<T>
): Ergebnis<T> {
    var attempts = 0
    while (true) {
        val r = call()
        if (r is Ergebnis.Error) {
            if (r.transient && attempts < maxAttempts - 1) {
                attempts++
                kotlinx.coroutines.delay(delayMs)
                continue
            }
        }
        return r
    }
}
