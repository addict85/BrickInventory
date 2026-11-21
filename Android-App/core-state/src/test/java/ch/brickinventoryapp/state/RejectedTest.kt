package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.state.ui.viewmodel.Texte
import ch.brickinventoryapp.network.util.followUpMay
import ch.brickinventoryapp.network.util.reportsTheSessionLayer
import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * After signing in, no „invalid or expired token“ may remain —
 * and nobody may read the token again on a lagging basis.
 *
 * ── What is NOT proven ──────────────────────────────────────────────────
 *
 * Which request got the 401 could not be determined without Logcat. This
 * file therefore deliberately does not check
 * „the error is gone“, but two rules that close off the CLASS. Whoever
 * reads this later should see the difference.
 *
 * Only what the case rules out was established: the app stayed signed in, and the
 * interceptor reports every 401 WITH a token sent along as an expired
 * session. So the request went out without a token.
 *
 * ── Counter-checks (carried out, result in the commit) ──────────────────────────
 *   a) method condition removed      → „ein fehlgeschlagener Login" red
 *   b) !hadAuthHeader removed         → „ein wirklich ungültiger Token" red
 *   c) one file set back to authToken.first() → the source rule red
 *   d) `angemeldet` in reportsTheSessionLayer ignored → „ein falsches
 *      Passwort bleibt ein falsches Passwort" red
 *   e) in Texte.meldungFuerSnackbar() always meldung(fehler) → „die Snackbar
 *      schweigt …" red
 * That the interceptor applies the rule is checked, run, by ServerGuardTest.
 */
class RejectedTest {

    // ── Die Regel selbst ────────────────────────────────────────────────────

    @Test
    fun `the observed case - a GET without a token to our server`() {
        assert(followUpMay(401, ourServer = true, hadAuthHeader = false, methode = "GET")) {
            "Genau dieser Fall ist Marcos Meldung: Die Galerie lädt beim Anmelden " +
                "per GET, und die Anfrage ging im Anmeldefenster ohne Token hinaus."
        }
    }

    @Test
    fun `a really invalid token is not retried`() {
        // If the request already carried a token and was rejected anyway,
        // it's invalid. This condition also rules out any loop
        // at the same time: the second attempt CARRIES the header.
        assert(!followUpMay(401, ourServer = true, hadAuthHeader = true, methode = "GET")) {
            "Ein 401 trotz mitgeschicktem Token wird wiederholt — das ist entweder " +
                "sinnlos oder eine Endlosschleife."
        }
    }

    @Test
    fun `a failed login is not retried`() {
        // POST /auth/login answers with 401 for a wrong password. A
        // second attempt would count the same try twice — against the server's
        // throttling and against the account lockout.
        assert(!followUpMay(401, ourServer = true, hadAuthHeader = false, methode = "POST")) {
            "Ein fehlgeschlagener Anmeldeversuch geht ein zweites Mal hinaus und " +
                "zählt doppelt gegen die Kontosperre."
        }
        for (m in listOf("PUT", "DELETE", "PATCH")) {
            assert(!followUpMay(401, ourServer = true, hadAuthHeader = false, methode = m)) {
                "$m wird blind wiederholt — schreibende Anfragen sind keine " +
                    "Wettlaufsituation, sondern eine eigene Fehlerquelle."
            }
        }
    }

    @Test
    fun `a foreign host is none of our business`() {
        assert(!followUpMay(401, ourServer = false, hadAuthHeader = false, methode = "GET")) {
            "Ein 401 von einem Bild-CDN löst einen zweiten Abruf MIT unserem Token aus."
        }
    }

    @Test
    fun `everything except 401 stays untouched`() {
        for (code in listOf(200, 204, 304, 400, 403, 404, 500, 503)) {
            assert(!followUpMay(code, ourServer = true, hadAuthHeader = false, methode = "GET")) {
                "Status $code wird als Anmeldeproblem behandelt."
            }
        }
    }

    // ── An expired session is ONE message, not two ──────────────

    @Test
    fun `a 401 in the signed-in state belongs to the session layer`() {
        // Two cases, ONE answer: on a real expiry the interceptor reports
        // „Sitzung abgelaufen" and signs out; on a race while signing in
        // there is nothing to report at all. In both cases
        // the fetch has nothing to tell the user.
        assert(reportsTheSessionLayer(unauthorized = true, angemeldet = true)) {
            "Der Abruf redet wieder ueber einen 401, den die Sitzungsschicht " +
                "schon behandelt hat — entweder doppelt (echter Ablauf) oder " +
                "falsch (Wettlauf beim Anmelden, Marcos Befund)."
        }
    }

    @Test
    fun `a wrong password stays a wrong password`() {
        // The server answers a wrong password with the same 401 and
        // the same message. But whoever isn't signed in has no session that
        // could expire — „Sitzung abgelaufen" would simply be a lie there.
        assert(!reportsTheSessionLayer(unauthorized = true, angemeldet = false)) {
            "Ein fehlgeschlagener Anmeldeversuch wird als abgelaufene Sitzung " +
                "gemeldet — der Nutzer sucht dann nach einem Problem, das es nicht gibt."
        }
    }

    @Test
    fun `without 401 nothing changes`() {
        for (angemeldet in listOf(true, false)) {
            assert(!reportsTheSessionLayer(unauthorized = false, angemeldet = angemeldet)) {
                "Ein Fehler ohne 401 wird als abgelaufene Sitzung gemeldet."
            }
        }
    }

    @Test
    fun `the snackbar stays silent instead of showing a different sentence`() {
        // Run against Texte, the one place for all ViewModels: a 401
        // with a token present returns null (the channel shows nothing), without a token
        // the message stays — then 401 means „wrong password".
        fun texts(mitToken: Boolean) = object : Texte {
            override fun text(id: Int, vararg args: Any?) = "t$id"
            override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id"
            override fun meldung(fehler: Ergebnis.Fehler) = "Satz"
            override fun angemeldet() = mitToken
        }
        val abgewiesen = Ergebnis.Fehler.Abgewiesen()
        assert(texts(mitToken = true).meldungFuerSnackbar(abgewiesen) == null) {
            "Ein 401 bei angemeldeter App erscheint wieder als Satz in der Snackbar."
        }
        assert(texts(mitToken = false).meldungFuerSnackbar(abgewiesen) == "Satz") {
            "Ohne Token ist ein 401 ein falsches Passwort und muss gezeigt werden."
        }
        assert(texts(mitToken = true).meldungFuerSnackbar(Ergebnis.Fehler.Netz()) == "Satz") {
            "Ein Netzfehler bei angemeldeter App verschwindet aus der Snackbar."
        }
    }

    @Test
    fun `no snackbar gets the sentence past the rule`() {
        // Whoever writes into the snackbar goes through meldungFuerSnackbar(); a new
        // spot using meldung() stands out here.
        val treffer = mutableListOf<String>()
        val schreibt = Regex("""\bzeigeMeldung\(|\b(?:meldungen|kanal)\.zeige\(""")
        var schreiber = 0
        for (datei in Quellen.alle()) {
            val name = datei.invariantSeparatorsPath.substringAfter("ch/brickinventoryapp/")
            val code = Quellen.withoutComments(datei.readText())
            for (zeile in code.lines()) {
                if (!schreibt.containsMatchIn(zeile)) continue
                schreiber++
                if (!Regex("""[^a-zA-Z]meldung\(""").containsMatchIn(zeile)) continue
                if (zeile.contains("meldungFuerSnackbar(")) continue
                treffer += "$name: ${zeile.trim()}"
            }
        }
        assert(schreiber >= 50) { "Nur $schreiber Schreibstellen der Snackbar gefunden — Muster veraltet?" }
        assert(treffer.isEmpty()) {
            "Diese Stellen schreiben meldung() direkt in die Snackbar und umgehen " +
                "damit die Regel: $treffer"
        }
    }

    // ── And nobody reads the token again on a lagging basis ──────────────────

    @Test
    fun `no file reads authToken or serverUrl bypassing the DataStore`() {
        // `authToken`/`serverUrl` are the DataStore flows and LAG BEHIND:
        // between saveAuthToken() and the finished disk write, they
        // still carry the old value. Every sign-in fires its first fetches
        // exactly in this window. tokenJetzt()/serverUrlJetzt() only pick up
        // the leading stored value.
        //
        val treffer = mutableListOf<String>()
        for (datei in Quellen.alle()) {
            // invariantSeparatorsPath and not path: on Windows — and this
            // project is built there — `path` returns backslashes, and the
            // cut would miss (see Quellen.unter()).
            val name = datei.invariantSeparatorsPath.substringAfter("ch/brickinventoryapp/")
            if (name.endsWith("TokenAblage.kt")) continue
            val code = Quellen.withoutComments(datei.readText())
            // Without `prefs.` in front: the manager isn't named the same
            // everywhere, and the rule applies to the flow, not the variable name.
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
}
