package ch.brickinventoryapp.app

import android.os.Looper
import org.robolectric.Shadows.shadowOf

/**
 * Drives the main looper until [ready] holds and three further rounds change neither requests
 * nor state. The sample world responds in ticks (PathServer.onTick), the
 * sample images load on the main looper: everything runs in these rounds, without a wall clock.
 */
fun driveUntil(name: String, requests: () -> Int = { 0 }, condition: () -> Any? = { null }, ready: () -> Boolean) {
    var calm = 0
    var last = requests()
    repeat(AT_MOST_ROUNDS) {
        shadowOf(Looper.getMainLooper()).idle()
        val now = requests()
        calm = if (now == last && ready()) calm + 1 else 0
        last = now
        if (calm >= CALM_ROUNDS) return
    }
    throw AssertionError("$name: nach $AT_MOST_ROUNDS Runden des Hauptloopers nicht bereit: ${condition()}")
}

private const val AT_MOST_ROUNDS = 200
private const val CALM_ROUNDS = 3
