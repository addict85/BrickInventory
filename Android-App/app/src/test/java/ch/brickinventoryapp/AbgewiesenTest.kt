package ch.brickinventoryapp

import ch.brickinventoryapp.util.darfNachfassen
import ch.brickinventoryapp.util.istAbgelaufeneSitzung
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
 *   d) `angemeldet` in istAbgelaufeneSitzung ignoriert → „ein falsches
 *      Passwort bleibt ein falsches Passwort" rot
 */
class AbgewiesenTest {

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

    // ── Eine abgelaufene Sitzung ist EINE Meldung, nicht zwei ──────────────

    @Test
    fun `eine abgelaufene Sitzung sagt die App mit eigenen Worten`() {
        // Der Interceptor meldet ab und zeigt „Sitzung abgelaufen". Der Abruf,
        // der den 401 kassiert hat, soll nicht den rohen Serversatz
        // hinterherschieben — das waeren zwei Meldungen zu einem Vorgang.
        assert(istAbgelaufeneSitzung(unauthorized = true, angemeldet = true)) {
            "Nach einer abgelaufenen Sitzung steht wieder „Ungueltiger oder " +
                "abgelaufener Token" neben der Abmeldung."
        }
    }

    @Test
    fun `ein falsches Passwort bleibt ein falsches Passwort`() {
        // Der Server antwortet auf ein falsches Passwort mit demselben 401 und
        // demselben Satz. Wer nicht angemeldet ist, hat aber keine Sitzung, die
        // ablaufen koennte — „Sitzung abgelaufen" waere dort schlicht gelogen.
        assert(!istAbgelaufeneSitzung(unauthorized = true, angemeldet = false)) {
            "Ein fehlgeschlagener Anmeldeversuch wird als abgelaufene Sitzung " +
                "gemeldet — der Nutzer sucht dann nach einem Problem, das es nicht gibt."
        }
    }

    @Test
    fun `ohne 401 aendert sich nichts`() {
        for (angemeldet in listOf(true, false)) {
            assert(!istAbgelaufeneSitzung(unauthorized = false, angemeldet = angemeldet)) {
                "Ein Fehler ohne 401 wird als abgelaufene Sitzung gemeldet."
            }
        }
    }

    @Test
    fun `meldung fragt die Regel, bevor sie den Serversatz durchreicht`() {
        val vm = Quellen.ohneKommentare(Quellen.lies("ui/MainViewModel.kt"))
        val i = vm.indexOf("internal fun meldung(")
        assert(i > 0) { "meldung() gibt es nicht mehr — Muster veraltet?" }
        val rumpf = vm.substring(i, (i + 1200).coerceAtMost(vm.length))
        val regel = rumpf.indexOf("istAbgelaufeneSitzung(")
        val durchreichen = rumpf.indexOf("fehler.message.isNotBlank()")
        assert(regel >= 0) { "meldung() fragt die Regel nicht — der Serversatz kommt wieder durch." }
        assert(durchreichen >= 0) { "Das Durchreichen des Serversatzes ist weg — Muster veraltet?" }
        assert(regel < durchreichen) {
            "Die Regel steht NACH dem Durchreichen. Dann gewinnt der Serversatz, " +
                "und die Pruefung darueber ist wirkungslos — genau der Satz soll " +
                "ja ersetzt werden."
        }
    }

    // ── Und niemand liest den Token wieder nachlaufend ──────────────────

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
            // invariantSeparatorsPath und nicht path: Auf Windows — und dort
            // wird dieses Projekt gebaut — liefert `path` Backslashes, und der
            // Schnitt ginge ins Leere (siehe Quellen.unter()).
            val name = datei.invariantSeparatorsPath.substringAfter("ch/brickinventoryapp/")
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
            "Der Interceptor fragt die Regel nicht mehr — dann ist util/Abgewiesen.kt " +
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
