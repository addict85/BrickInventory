package ch.brickinventoryapp

import android.os.Looper
import org.robolectric.Shadows.shadowOf

/**
 * Treibt den Hauptlooper, bis [bereit] gilt und drei weitere Runden weder Anfragen
 * noch Zustand ändern. Die Beispielwelt antwortet im Takt (PfadServer.imTakt), die
 * Beispielbilder laden auf dem Hauptlooper: Alles läuft in diesen Runden, ohne Wanduhr.
 */
fun treibeBis(name: String, anfragen: () -> Int = { 0 }, zustand: () -> Any? = { null }, bereit: () -> Boolean) {
    var ruhig = 0
    var zuletzt = anfragen()
    repeat(HOECHSTENS_RUNDEN) {
        shadowOf(Looper.getMainLooper()).idle()
        val jetzt = anfragen()
        ruhig = if (jetzt == zuletzt && bereit()) ruhig + 1 else 0
        zuletzt = jetzt
        if (ruhig >= RUHIGE_RUNDEN) return
    }
    throw AssertionError("$name: nach $HOECHSTENS_RUNDEN Runden des Hauptloopers nicht bereit: ${zustand()}")
}

private const val HOECHSTENS_RUNDEN = 200
private const val RUHIGE_RUNDEN = 3
