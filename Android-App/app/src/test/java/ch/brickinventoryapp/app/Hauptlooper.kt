package ch.brickinventoryapp.app

import android.os.Looper
import org.robolectric.Shadows.shadowOf

/**
 * Treibt den Hauptlooper, bis [bereit] gilt und drei weitere Runden weder Anfragen
 * noch Zustand ändern. Die Beispielwelt antwortet im Takt (PfadServer.imTakt), die
 * Beispielbilder laden auf dem Hauptlooper: Alles läuft in diesen Runden, ohne Wanduhr.
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
