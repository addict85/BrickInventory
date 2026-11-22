package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.network.util.followUpMay
import ch.brickinventoryapp.network.util.reportsTheSessionLayer
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import ch.brickinventoryapp.testing.Sources
import org.junit.Test

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
 *   d) `loggedIn` in reportsTheSessionLayer ignored → „ein falsches
 *      Passwort bleibt ein falsches Passwort" red
 *   e) in Texte.messageForSnackbar() always meldung(fehler) → „die Snackbar
 *      schweigt …" red
 * That the interceptor applies the rule is checked, run, by ServerGuardTest.
 */
class RejectedTest {

    // ── Die Regel selbst ────────────────────────────────────────────────────

    @Test
    fun `the observed case - a GET without a token to our server`() {
        assert(followUpMay(401, ourServer = true, hadAuthHeader = false, method = "GET")) {
            "Genau dieser Fall ist Marcos Meldung: Die Galerie lädt beim Anmelden " +
                "per GET, und die Anfrage ging im Anmeldefenster ohne Token hinaus."
        }
    }

    @Test
    fun `a really invalid token is not retried`() {
        // If the request already carried a token and was rejected anyway,
        // it's invalid. This condition also rules out any loop
        // at the same time: the second attempt CARRIES the header.
        assert(!followUpMay(401, ourServer = true, hadAuthHeader = true, method = "GET")) {
            "Ein 401 trotz mitgeschicktem Token wird wiederholt — das ist entweder " +
                "sinnlos oder eine Endlosschleife."
        }
    }

    @Test
    fun `a failed login is not retried`() {
        // POST /auth/login answers with 401 for a wrong password. A
        // second attempt would count the same try twice — against the server's
        // throttling and against the account lockout.
        assert(!followUpMay(401, ourServer = true, hadAuthHeader = false, method = "POST")) {
            "Ein fehlgeschlagener Anmeldeversuch geht ein zweites Mal hinaus und " +
                "zählt doppelt gegen die Kontosperre."
        }
        for (m in listOf("PUT", "DELETE", "PATCH")) {
            assert(!followUpMay(401, ourServer = true, hadAuthHeader = false, method = m)) {
                "$m wird blind wiederholt — schreibende Anfragen sind keine " +
                    "Wettlaufsituation, sondern eine eigene Fehlerquelle."
            }
        }
    }

    @Test
    fun `a foreign host is none of our business`() {
        assert(!followUpMay(401, ourServer = false, hadAuthHeader = false, method = "GET")) {
            "Ein 401 von einem Bild-CDN löst einen zweiten Abruf MIT unserem Token aus."
        }
    }

    @Test
    fun `everything except 401 stays untouched`() {
        for (code in listOf(200, 204, 304, 400, 403, 404, 500, 503)) {
            assert(!followUpMay(code, ourServer = true, hadAuthHeader = false, method = "GET")) {
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
        assert(reportsTheSessionLayer(unauthorized = true, loggedIn = true)) {
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
        assert(!reportsTheSessionLayer(unauthorized = true, loggedIn = false)) {
            "Ein fehlgeschlagener Anmeldeversuch wird als abgelaufene Sitzung " +
                "gemeldet — der Nutzer sucht dann nach einem Problem, das es nicht gibt."
        }
    }

    @Test
    fun `without 401 nothing changes`() {
        for (loggedIn in listOf(true, false)) {
            assert(!reportsTheSessionLayer(unauthorized = false, loggedIn = loggedIn)) {
                "Ein Fehler ohne 401 wird als abgelaufene Sitzung gemeldet."
            }
        }
    }

    @Test
    fun `the snackbar stays silent instead of showing a different sentence`() {
        // Run against Texte, the one place for all ViewModels: a 401
        // with a token present returns null (the channel shows nothing), without a token
        // the message stays — then 401 means „wrong password".
        fun texts(withToken: Boolean) = object : Texts {
            override fun text(id: Int, vararg args: Any?) = "t$id"
            override fun quantity(id: Int, count: Int, vararg args: Any?) = "m$id"
            override fun message(error: Outcome.Failure) = "Satz"
            override fun loggedIn() = withToken
        }
        val rejected = Outcome.Failure.Rejected()
        assert(texts(withToken = true).messageForSnackbar(rejected) == null) {
            "Ein 401 bei angemeldeter App erscheint wieder als Satz in der Snackbar."
        }
        assert(texts(withToken = false).messageForSnackbar(rejected) == "Satz") {
            "Ohne Token ist ein 401 ein falsches Passwort und muss gezeigt werden."
        }
        assert(texts(withToken = true).messageForSnackbar(Outcome.Failure.Network()) == "Satz") {
            "Ein Netzfehler bei angemeldeter App verschwindet aus der Snackbar."
        }
    }

    @Test
    fun `no snackbar gets the sentence past the rule`() {
        // Whoever writes into the snackbar goes through messageForSnackbar(); a new
        // spot using message() stands out here.
        val hits = mutableListOf<String>()
        val writes = Regex("""\bzeigeMeldung\(|\b(?:messages|channel)\.show\(""")
        var writer = 0
        for (file in Sources.all()) {
            val name = file.invariantSeparatorsPath.substringAfter("ch/brickinventoryapp/")
            val code = Sources.withoutComments(file.readText())
            for (row in code.lines()) {
                if (!writes.containsMatchIn(row)) continue
                writer++
                if (!Regex("""[^a-zA-Z]message\(""").containsMatchIn(row)) continue
                if (row.contains("messageForSnackbar(")) continue
                hits += "$name: ${row.trim()}"
            }
        }
        assert(writer >= 50) { "Nur $writer Schreibstellen der Snackbar gefunden — Muster veraltet?" }
        assert(hits.isEmpty()) {
            "Diese Stellen schreiben message() direkt in die Snackbar und umgehen " +
                "damit die Regel: $hits"
        }
    }

    // ── And nobody reads the token again on a lagging basis ──────────────────

    @Test
    fun `no file reads authToken or serverUrl bypassing the DataStore`() {
        // `authToken`/`serverUrl` are the DataStore flows and LAG BEHIND:
        // between saveAuthToken() and the finished disk write, they
        // still carry the old value. Every sign-in fires its first fetches
        // exactly in this window. tokenNow()/serverUrlNow() only pick up
        // the leading stored value.
        //
        val hits = mutableListOf<String>()
        for (file in Sources.all()) {
            // invariantSeparatorsPath and not path: on Windows — and this
            // project is built there — `path` returns backslashes, and the
            // cut would miss (see Quellen.below()).
            val name = file.invariantSeparatorsPath.substringAfter("ch/brickinventoryapp/")
            if (name.endsWith("TokenStore.kt")) continue
            val code = Sources.withoutComments(file.readText())
            // Without `prefs.` in front: the manager isn't named the same
            // everywhere, and the rule applies to the flow, not the variable name.
            if (Regex("""\.(authToken|serverUrl)\.first\(\)""").containsMatchIn(code))
                hits += name
        }
        assert(hits.isEmpty()) {
            "Diese Dateien lesen den nachlaufenden DataStore-Fluss statt " +
                "tokenNow()/serverUrlNow(): $hits — beim Anmelden geht dort " +
                "eine Anfrage ohne Token hinaus, und der Server antwortet mit " +
                "„Ungültiger oder abgelaufener Token\"."
        }
    }
}
