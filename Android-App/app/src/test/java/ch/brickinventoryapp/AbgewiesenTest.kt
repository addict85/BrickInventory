package ch.brickinventoryapp

import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.viewmodel.Texte
import ch.brickinventoryapp.util.darfNachfassen
import ch.brickinventoryapp.util.meldetDieSitzungsschicht
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
 *   d) `angemeldet` in meldetDieSitzungsschicht ignoriert → „ein falsches
 *      Passwort bleibt ein falsches Passwort" rot
 *   e) in Texte.meldungFuerSnackbar() immer meldung(fehler) → „die Snackbar
 *      schweigt …" rot (28.10.2026)
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
    fun `ein 401 im angemeldeten Zustand gehoert der Sitzungsschicht`() {
        // Zwei Faelle, EINE Antwort: Bei einem echten Ablauf meldet der
        // Interceptor „Sitzung abgelaufen" und meldet ab; bei einem Wettlauf
        // beim Anmelden ist ueberhaupt nichts zu melden. In beiden Faellen hat
        // der Abruf dem Nutzer nichts zu sagen.
        assert(meldetDieSitzungsschicht(unauthorized = true, angemeldet = true)) {
            "Der Abruf redet wieder ueber einen 401, den die Sitzungsschicht " +
                "schon behandelt hat — entweder doppelt (echter Ablauf) oder " +
                "falsch (Wettlauf beim Anmelden, Marcos Befund)."
        }
    }

    @Test
    fun `ein falsches Passwort bleibt ein falsches Passwort`() {
        // Der Server antwortet auf ein falsches Passwort mit demselben 401 und
        // demselben Satz. Wer nicht angemeldet ist, hat aber keine Sitzung, die
        // ablaufen koennte — „Sitzung abgelaufen" waere dort schlicht gelogen.
        assert(!meldetDieSitzungsschicht(unauthorized = true, angemeldet = false)) {
            "Ein fehlgeschlagener Anmeldeversuch wird als abgelaufene Sitzung " +
                "gemeldet — der Nutzer sucht dann nach einem Problem, das es nicht gibt."
        }
    }

    @Test
    fun `ohne 401 aendert sich nichts`() {
        for (angemeldet in listOf(true, false)) {
            assert(!meldetDieSitzungsschicht(unauthorized = false, angemeldet = angemeldet)) {
                "Ein Fehler ohne 401 wird als abgelaufene Sitzung gemeldet."
            }
        }
    }

    @Test
    fun `die Snackbar schweigt, statt einen anderen Satz zu zeigen`() {
        // Ausgeführt an Texte, der einen Stelle für alle ViewModels: Ein 401
        // bei vorliegendem Token gibt null (der Kanal zeigt nichts), ohne Token
        // bleibt der Satz — dann heisst 401 „falsches Passwort".
        fun texte(mitToken: Boolean) = object : Texte {
            override fun text(id: Int, vararg args: Any?) = "t$id"
            override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id"
            override fun meldung(fehler: Result.Error) = "Satz"
            override fun angemeldet() = mitToken
        }
        val abgewiesen = Result.Error("", unauthorized = true)
        assert(texte(mitToken = true).meldungFuerSnackbar(abgewiesen) == null) {
            "Ein 401 bei angemeldeter App erscheint wieder als Satz in der Snackbar."
        }
        assert(texte(mitToken = false).meldungFuerSnackbar(abgewiesen) == "Satz") {
            "Ohne Token ist ein 401 ein falsches Passwort und muss gezeigt werden."
        }
        assert(texte(mitToken = true).meldungFuerSnackbar(Result.Error("", transient = true)) == "Satz") {
            "Ein Netzfehler bei angemeldeter App verschwindet aus der Snackbar."
        }
    }

    @Test
    fun `keine Snackbar bekommt den Satz an der Regel vorbei`() {
        // DIE Regel, die Marcos Befund verhindert haette: Wer in die Snackbar
        // schreibt, geht ueber meldungFuerSnackbar(). Sechsunddreissig Stellen
        // taten es vorher ueber meldung() — eine neue faellt jetzt auf.
        val treffer = mutableListOf<String>()
        for (datei in Quellen.alle()) {
            val name = datei.invariantSeparatorsPath.substringAfter("ch/brickinventoryapp/")
            val code = Quellen.ohneKommentare(datei.readText())
            for (zeile in code.lines()) {
                if (!zeile.contains("_snackbar")) continue
                if (!Regex("""[^a-zA-Z]meldung\(""").containsMatchIn(zeile)) continue
                if (zeile.contains("meldungFuerSnackbar(")) continue
                treffer += "$name: ${zeile.trim()}"
            }
        }
        assert(treffer.isEmpty()) {
            "Diese Stellen schreiben meldung() direkt in die Snackbar und umgehen " +
                "damit die Regel: $treffer"
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
        // di/ServerClient.kt ist die einzige Ausnahme, und sie ist begründet: Der
        // Interceptor läuft auf OkHttp-Threads und darf dort nicht
        // suspendieren; er schreibt dieselbe Regel deshalb aus.
        val treffer = mutableListOf<String>()
        for (datei in Quellen.alle()) {
            // invariantSeparatorsPath und nicht path: Auf Windows — und dort
            // wird dieses Projekt gebaut — liefert `path` Backslashes, und der
            // Schnitt ginge ins Leere (siehe Quellen.unter()).
            val name = datei.invariantSeparatorsPath.substringAfter("ch/brickinventoryapp/")
            if (name.endsWith("PreferencesManager.kt") || name.endsWith("di/ServerClient.kt")) continue
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
        val di = Quellen.ohneKommentare(Quellen.di())
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
