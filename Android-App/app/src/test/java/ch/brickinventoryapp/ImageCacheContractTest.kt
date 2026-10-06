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
 *   1. Coil fragt beim Server nach, statt blind zu behalten — bedingte Anfrage
 *      (If-None-Match mit dem ETag); unverändert → 304, geändert → neue Bytes.
 *
 * ── Was Coil 3 daran geändert hat (05.10.) ──────────────────────────────────
 *
 * Teil 1 hiess bis dahin `respectCacheHeaders(true)`, und dieser Test suchte
 * genau diese Zeichenkette. In Coil 3 gibt es sie nicht mehr: Das Verhalten
 * sitzt am Netzwerk-Fetcher und heisst CacheStrategy.
 *
 * NACHGESEHEN in coil-network-core 3.3.0 — es gibt GENAU EINE Implementierung
 * (internal DefaultCacheStrategy, erreichbar als CacheStrategy.DEFAULT), und
 * die ist der Vorgabewert. Eine Fassung, die Cache-Köpfe ignoriert, lässt sich
 * gar nicht mehr hinschreiben; der Rückfall in den Zustand von vor Nachtrag 37
 * ist damit baulich ausgeschlossen statt nur verboten.
 *
 * Teil 1 prüft deshalb jetzt etwas anderes für dieselbe Sache: dass der
 * Netzwerk-Fetcher überhaupt angesteckt ist. Ohne ihn lädt Coil 3 gar nichts
 * aus dem Netz — und was nie geladen wird, wird auch nie aufgefrischt.
 *
 * WAS DIESER TEST NICHT MEHR KANN, und das soll hier stehen: Er bewies vorher
 * eine SCHALTERSTELLUNG. Jetzt bezeugt er nur noch, dass der Weg existiert.
 * Ob DefaultCacheStrategy sich im Einzelnen wie respectCacheHeaders(true)
 * verhält, steht in ihrem Rumpf, den ich nicht gelesen habe — diese Probe
 * gehört auf ein Gerät: ein Bild auf dem Server austauschen und nachsehen.
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
    fun `Coil laedt ueberhaupt aus dem Netz, und damit ueber die Cache-Strategie`() {
        // ── Der Name ist mit Absicht der KOTLIN-Name ───────────────────
        //
        // Diese Zusicherung stand zuerst auf `OkHttpNetworkFetcher.factory(`
        // — demselben falschen Namen, den auch der Code trug. Damit war sie
        // gruen und wertlos: Eine Textpruefung, die den Fehler des Codes
        // wiederholt, kann ihn nicht finden. Gefunden hat ihn erst der
        // Uebersetzer.
        //
        // Nachgesehen in den Quellen von coil-network-okhttp 3.3.0: Die freie
        // Funktion heisst `OkHttpNetworkFetcherFactory`. `@file:JvmName` und
        // `@JvmName("factory")` erzeugen daraus NUR fuer Java
        // `OkHttpNetworkFetcher.factory(...)`.
        assert(src.contains("OkHttpNetworkFetcherFactory(")) {
            "Dem ImageLoader fehlt der Netzwerk-Fetcher. Coil 3 kennt http(s) nur " +
                "ueber dieses Bauteil; ohne es bleibt jede Kachel leer, ohne " +
                "Fehlermeldung — und ein veraltetes Bild wird nie aufgefrischt, " +
                "weil ueberhaupt nichts mehr geholt wird."
        }
        // Der Client gehoert MIT uebergeben: Nur so haengen Anmeldung,
        // Zeitgrenzen und der Offline-Rueckfall unten auch am Bild-Weg. Die
        // Fabrik ohne Argument baut sich einen eigenen Client.
        assert(!src.contains("OkHttpNetworkFetcherFactory()")) {
            "Der Netzwerk-Fetcher baut sich einen EIGENEN OkHttpClient. Damit " +
                "verliert der Bild-Weg den Zwischenspeicher und den " +
                "FORCE_CACHE-Rueckfall, die weiter unten geprueft werden."
        }
        assert(!src.contains("respectCacheHeaders")) {
            "respectCacheHeaders gibt es in Coil 3 nicht mehr; das Verhalten " +
                "steckt in der CacheStrategy des Fetchers."
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
