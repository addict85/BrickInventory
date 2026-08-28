package ch.brickinventoryapp

import org.junit.Test

/**
 * Bild-Zwischenspeicher: nachfragen statt blind behalten — und offline aus dem
 * Cache.
 *
 * ── Woher dieser Test kommt (Marcos Anforderung, Nachtrag 37) ───────────────
 * Wörtlich: „Wenn ein falsches Bild in der Android-App heruntergeladen wurde,
 * soll diese jeweils prüfen, ob ein neues auf dem Server vorhanden ist […].
 * Wenn der Server nicht erreichbar ist, sollen alle aus dem Cache kommen."
 *
 * Vorher stand im ImageLoader `respectCacheHeaders(false)` — Coil lieferte ein
 * einmal geladenes Bild AUF IMMER aus seinem Plattencache und stellte nie
 * wieder eine Anfrage. Ein falsches oder veraltetes Bild liess sich nur durch
 * Löschen der App-Daten beseitigen. Serverseitig kam dasselbe von der anderen
 * Seite: die Bildroute schickte `max-age=604800`, also eine Woche ohne
 * Rückfrage. (Der Pfad wird hier bewusst nicht mit Sternchen geschrieben:
 * Kotlin erlaubt VERSCHACHTELTE Blockkommentare, ein "/" gefolgt von "*"
 * öffnet also mitten im Text einen zweiten Kommentar — der nie geschlossen
 * wird und die ganze Datei verschluckt.)
 *
 * Die drei Teile gehören zusammen und sind einzeln wertlos:
 *   1. respectCacheHeaders(true) — Coil stellt eine bedingte Anfrage
 *      (If-None-Match mit dem ETag); unverändert → 304, geändert → neue Bytes.
 *   2. ein HTTP-Zwischenspeicher am Bild-Client — ohne ihn gäbe es nichts, aus
 *      dem der Offline-Fall bedient werden könnte.
 *   3. der Rückfall auf FORCE_CACHE bei einer IOException — bewusst am
 *      FEHLER festgemacht, nicht am Verbindungsstatus des Geräts: Ein Gerät
 *      kann im WLAN sein und den Heimserver trotzdem nicht erreichen.
 *
 * Der Test liest nur die Quelldatei — kein Gerät, kein Netz, kein Compose.
 */
class ImageCacheContractTest {

    private fun read(rel: String): String {
        val f = java.io.File(rel)
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(src: String) = src.lines().joinToString("\n") { line ->
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) "" else line
    }

    private val src by lazy { code(read("src/main/java/ch/brickinventoryapp/di/AppModule.kt")) }

    @Test
    fun `Coil beachtet die Cache-Kopfzeilen und fragt beim Server nach`() {
        assert(src.contains("respectCacheHeaders(true)")) {
            "Mit respectCacheHeaders(false) liefert Coil ein einmal geladenes Bild auf " +
                "immer aus dem Plattencache — ein falsches Bild wird nie ersetzt."
        }
        assert(!src.contains("respectCacheHeaders(false)")) {
            "respectCacheHeaders(false) ist zurück"
        }
    }

    @Test
    fun `der Bild-Client hat einen HTTP-Zwischenspeicher`() {
        assert(src.contains("okhttp3.Cache(")) {
            "Ohne HTTP-Zwischenspeicher gibt es nichts, woraus der Offline-Fall bedient " +
                "werden könnte — und keine bedingten Anfragen mit ETag."
        }
    }

    @Test
    fun `ist der Server nicht erreichbar, kommt das Bild aus dem Cache`() {
        assert(src.contains("okhttp3.CacheControl.FORCE_CACHE")) {
            "Der Offline-Rückfall fehlt: Ohne FORCE_CACHE bleibt die Kachel leer, " +
                "obwohl eine gespeicherte Kopie vorliegt."
        }
        assert(src.contains("catch (e: java.io.IOException)")) {
            "Der Rückfall muss am tatsächlichen Fehler hängen, nicht am gemeldeten " +
                "Verbindungsstatus — ein Gerät kann im WLAN sein und den Server trotzdem " +
                "nicht erreichen."
        }
    }
}
