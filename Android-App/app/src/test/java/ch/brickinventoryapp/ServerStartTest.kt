package ch.brickinventoryapp

import org.junit.Test

/**
 * Waehrend der Server startet, zeigt die App den Fortschritt — keinen Fehler.
 *
 * ── Woher dieser Test kommt (Nachtrag 136) ──────────────────────────────────
 *
 * Aus derselben Messung wie die Nachtraege davor: /v1/startup-status war eine
 * der Adressen, die nur die Webapp ruft. Sie zeigt damit einen
 * Fortschrittsbalken, solange der Server hochfaehrt, und begruendet das im
 * eigenen Kommentar (01-core.js): Der erste Start einer Neuinstallation holt
 * den Rebrickable-Katalog und dauert VIELE MINUTEN.
 *
 * Die App zeigte in dieser ganzen Zeit ihre allgemeine Netzmeldung. Wer seinen
 * Server frisch aufsetzt und die App oeffnet, sieht „keine Verbindung" — und
 * haelt das eine oder das andere fuer kaputt, obwohl alles richtig laeuft.
 *
 * Der Test liest nur Quelltext: kein Geraet, kein Compose.
 */
class ServerStartTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die App fragt den Startzustand ab`() {
        val api = code(read("data/api/BrickApiService.kt"))
        assert(api.contains("@GET(\"api/v1/startup-status\")")) {
            "Die App kennt den Startzustand nicht"
        }
    }

    @Test
    fun `keine Antwort heisst NICHT dass der Server startet`() {
        // Der wichtigste Unterschied: Antwortet der Server gar nicht, ist er
        // nicht erreichbar — dann ist die gewoehnliche Netzmeldung die
        // richtige. Nur wenn er ANTWORTET und `ready` verneint, laeuft ein
        // Start. Ohne diese Trennung zeigte die App „Der Server startet" auch
        // bei einer falsch eingetippten Adresse.
        val s = code(read("ui/SettingsFeature.kt"))
        val ab = s.indexOf("fun MainViewModel.verfolgeServerstart(")
        assert(ab > 0) { "verfolgeServerstart fehlt" }
        val rumpf = s.substring(ab, minOf(ab + 1400, s.length))
        val fehlerzweig = rumpf.indexOf("is Result.Error ->")
        assert(fehlerzweig > 0) { "Der Fehlerfall wird nicht behandelt" }
        val danach = rumpf.substring(fehlerzweig, minOf(fehlerzweig + 200, rumpf.length))
        assert(danach.contains("startupStatus = null")) {
            "Bei einer ausbleibenden Antwort bleibt der Startzustand stehen — " +
                "die App behauptet dann einen Serverstart, den es nicht gibt"
        }
    }

    @Test
    fun `ist der Server fertig, hoert die Abfrage auf`() {
        val s = code(read("ui/SettingsFeature.kt"))
        val ab = s.indexOf("fun MainViewModel.verfolgeServerstart(")
        val rumpf = s.substring(ab, minOf(ab + 1400, s.length))
        assert(rumpf.contains("if (r.data.ready)")) {
            "Die Schleife prueft nicht, ob der Server fertig ist — sie liefe ewig"
        }
    }

    @Test
    fun `die Anmeldung zeigt den Fortschritt statt des Formulars`() {
        val s = code(read("nav/AuthGraph.kt"))
        assert(s.contains("ServerStartAnzeige(serverStart)")) {
            "Die Anmeldung zeigt den Startfortschritt nicht"
        }
        // Der Sprung in die Galerie muss AUSSERHALB des if/else stehen: Der
        // Wechsel auf „fertig" kann jederzeit kommen.
        val anzeige = s.indexOf("ServerStartAnzeige(serverStart)")
        val sprung = s.indexOf("LaunchedEffect(state.isLoggedIn)")
        assert(sprung > anzeige) { "Test veraltet — die Reihenfolge stimmt nicht mehr" }
        val dazwischen = s.substring(anzeige, sprung)
        assert(dazwischen.contains("} else LoginScreen(")) {
            "Anzeige und Formular stehen nicht als Entweder-Oder da"
        }
    }
}
