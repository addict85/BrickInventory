package ch.brickinventoryapp

import ch.brickinventoryapp.util.darfNachfassen
import org.junit.Test

/**
 * Nach dem Anmelden darf kein „Ungültiger oder abgelaufener Token" stehen
 * bleiben — und niemand darf den Token wieder nachlaufend lesen.
 *
 * ── Marcos Befund vom 25.09. ────────────────────────────────────────────────
 *
 *   „Wenn ich mich in der Webapp einlogge, einen qr Code erzeuge und mit diesem
 *    in die App einlogge funktioniert es, es erscheint aber die Meldung, dass
 *    das token nicht gültig sei. Wenn ich einen 2. Qr Code generiere und
 *    nochmals einlogge erscheint die Meldung nicht mehr."
 *
 * ── Was NICHT bewiesen ist ──────────────────────────────────────────────────
 *
 * Welche Anfrage den 401 bekam. Ohne Logcat war das nicht festzustellen, und
 * Marco konnte keines liefern. Diese Datei prüft deshalb ausdrücklich nicht
 * „der Fehler ist weg", sondern zwei Regeln, die die KLASSE schliessen. Wer
 * das später liest, soll den Unterschied sehen.
 *
 * Belegt war nur, was der Fall ausschliesst: Die App blieb angemeldet, und der
 * Interceptor meldet jeden 401 MIT mitgeschicktem Token als abgelaufene
 * Sitzung. Also ging die Anfrage ohne Token hinaus.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Methodenbedingung entfernt      → „ein fehlgeschlagener Login" rot
 *   b) !hatteAuthKopf entfernt         → „ein wirklich ungültiger Token" rot
 *   c) eine Datei wieder auf authToken.first() → die Quellenregel rot
 */
class NachfassenTest {

    // ── Die Regel selbst ────────────────────────────────────────────────────

    @Test
    fun `der beobachtete Fall - ein GET ohne Token an unseren Server`() {
        assert(darfNachfassen(401, unserServer = true, hatteAuthKopf = false, methode = "GET")) {
            "Genau dieser Fall ist Marcos Meldung: Die Galerie lädt beim Anmelden " +
                "per GET, und die Anfrage ging im Anmeldefenster ohne Token hinaus."
        }
    }

    @Test
    fun `ein wirklich ungueltiger Token wird nicht wiederholt`() {
        // Trug die Anfrage bereits einen Token und wurde trotzdem abgewiesen,
        // ist er ungültig. Diese Bedingung schliesst zugleich jede Schleife
        // aus: Der zweite Anlauf TRÄGT den Kopf.
        assert(!darfNachfassen(401, unserServer = true, hatteAuthKopf = true, methode = "GET")) {
            "Ein 401 trotz mitgeschicktem Token wird wiederholt — das ist entweder " +
                "sinnlos oder eine Endlosschleife."
        }
    }

    @Test
    fun `ein fehlgeschlagener Login wird nicht wiederholt`() {
        // POST /auth/login antwortet mit 401 auf ein falsches Passwort. Ein
        // zweiter Anlauf zählte denselben Versuch doppelt — gegen die Drossel
        // des Servers und gegen die Kontosperre.
        assert(!darfNachfassen(401, unserServer = true, hatteAuthKopf = false, methode = "POST")) {
            "Ein fehlgeschlagener Anmeldeversuch geht ein zweites Mal hinaus und " +
                "zählt doppelt gegen die Kontosperre."
        }
        for (m in listOf("PUT", "DELETE", "PATCH")) {
            assert(!darfNachfassen(401, unserServer = true, hatteAuthKopf = false, methode = m)) {
                "$m wird blind wiederholt — schreibende Anfragen sind keine " +
                    "Wettlaufsituation, sondern eine eigene Fehlerquelle."
            }
        }
    }

    @Test
    fun `ein fremder Host geht uns nichts an`() {
        assert(!darfNachfassen(401, unserServer = false, hatteAuthKopf = false, methode = "GET")) {
            "Ein 401 von einem Bild-CDN löst einen zweiten Abruf MIT unserem Token aus."
        }
    }

    @Test
    fun `alles ausser 401 bleibt unberuehrt`() {
        for (code in listOf(200, 204, 304, 400, 403, 404, 500, 503)) {
            assert(!darfNachfassen(code, unserServer = true, hatteAuthKopf = false, methode = "GET")) {
                "Status $code wird als Anmeldeproblem behandelt."
            }
        }
    }

    // ── Und niemand liest den Token wieder nachlaufend ──────────────────────

    @Test
    fun `keine Datei liest authToken oder serverUrl am DataStore vorbei`() {
        // `authToken`/`serverUrl` sind die DataStore-Flüsse und LAUFEN NACH:
        // Zwischen saveAuthToken() und der fertigen Plattenschreibung tragen
        // sie noch den alten Wert. Genau in diesem Fenster feuert jede
        // Anmeldung ihre ersten Abrufe. tokenJetzt()/serverUrlJetzt() nehmen
        // erst den führenden Speicherwert.
        //
        // AppModule ist die einzige Ausnahme, und sie ist begründet: Der
        // Interceptor läuft auf OkHttp-Threads und darf dort nicht
        // suspendieren; er schreibt dieselbe Regel deshalb aus.
        val treffer = mutableListOf<String>()
        for (datei in Quellen.alle()) {
            val name = datei.path.substringAfter("ch/brickinventoryapp/")
            if (name.endsWith("PreferencesManager.kt") || name.endsWith("AppModule.kt")) continue
            val code = Quellen.ohneKommentare(datei.readText())
            // Ohne `prefs.` davor: Der Manager heisst nicht ueberall gleich,
            // und die Regel gilt dem Fluss, nicht dem Variablennamen.
            if (Regex("""\.(authToken|serverUrl)\.first\(\)""").containsMatchIn(code))
                treffer += name
        }
        assert(treffer.isEmpty()) {
            "Diese Dateien lesen den nachlaufenden DataStore-Fluss statt " +
                "tokenJetzt()/serverUrlJetzt(): $treffer — beim Anmelden geht dort " +
                "eine Anfrage ohne Token hinaus, und der Server antwortet mit " +
                "„Ungültiger oder abgelaufener Token\"."
        }
    }

    @Test
    fun `der Interceptor benutzt die Regel und faellt nicht in eine Schleife`() {
        val di = Quellen.ohneKommentare(Quellen.lies("di/AppModule.kt"))
        assert(di.contains("darfNachfassen(")) {
            "Der Interceptor fragt die Regel nicht mehr — dann ist util/Nachfassen.kt " +
                "totes Gewicht und der Fehler zurück."
        }
        // Der zweite Anlauf MUSS den Kopf setzen: Ohne ihn liefe er erneut in
        // dieselbe Bedingung.
        assert(di.contains("""outgoing.newBuilder().header("Authorization", "Bearer ${'$'}jetzt")""")) {
            "Der zweite Anlauf setzt den Authorization-Kopf nicht — Endlosschleife."
        }
        // Und die Sitzungsmeldung muss den zweiten Anlauf kennen, sonst bliebe
        // ein wirklich abgelaufener Token nach dem Nachfassen unbemerkt.
        assert(di.contains("tokenMitgeschickt")) {
            "Die Abgelaufen-Meldung rechnet den zweiten Anlauf nicht mit."
        }
    }
}
