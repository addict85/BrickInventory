package ch.brickinventoryapp.app

import android.os.Looper
import org.robolectric.Shadows.shadowOf

/**
 * Drives the main looper until [bereit] holds and three further rounds change neither requests
 * nor state. The sample world responds in ticks (PfadServer.imTakt), the
 * sample images load on the main looper: everything runs in these rounds, without a wall clock.
 */
fun driveUntil(name: String, requests: () -> Int = { 0 }, zustand: () -> Any? = { null }, bereit: () -> Boolean) {
    var ruhig = 0
    var zuletzt = requests()
    repeat(AT_MOST_ROUNDS) {
        shadowOf(Looper.getMainLooper()).idle()
        val jetzt = requests()
        ruhig = if (jetzt == zuletzt && bereit()) ruhig + 1 else 0
        zuletzt = jetzt
        if (ruhig >= CALM_ROUNDS) return
    }
    throw AssertionError("$name: nach $AT_MOST_ROUNDS Runden des Hauptloopers nicht bereit: ${zustand()}")
}

private const val AT_MOST_ROUNDS = 200
private const val CALM_ROUNDS = 3
