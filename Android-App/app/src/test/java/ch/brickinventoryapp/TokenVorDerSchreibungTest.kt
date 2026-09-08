package ch.brickinventoryapp

import org.junit.Test

/**
 * Der Interceptor sieht den neuen Token, BEVOR die erste Anfrage rausgeht.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Wenn ich mich neu in der Android-App einlogge erscheint folgende Meldung:
 * ‚ungültig oder abgelaufenes Token.' Ich werde aber trotzdem eingeloggt."
 *
 * ── Warum beides zugleich moeglich war ──────────────────────────────────────
 * Die Anmeldung selbst gelingt — sie braucht keinen Token, sie holt ihn. Was
 * danach kommt, brauchte ihn:
 *
 *     prefs.saveAuthToken(neu)          // stoesst eine DataStore-Schreibung an
 *     _state.update { isLoggedIn = true }
 *     loadDashboard()                   // feuert SOFORT Anfragen
 *
 * `authTokenState` war ein `stateIn()` ueber den DataStore-Fluss und folgte
 * der Schreibung erst, wenn diese durch war — eine Plattenschreibung auf
 * Dispatchers.IO. Der Interceptor (AppModule.kt) liest den Wert SYNCHRON und
 * traf in diesem Fenster noch den alten. Bei einer frischen Anmeldung ist der
 * leer: Die Anfrage ging ohne Authorization-Kopf raus, requireToken
 * antwortete mit 401 und `token_ungueltig`, und loadSets() zeigte den Text
 * des Servers an.
 *
 * Dieselbe Falle bei der Server-Adresse: loginWithQrToken() speichert sie und
 * loest den QR-Code unmittelbar danach ein — der Aufruf ging an den
 * VORHERIGEN Server, der die Nonce nicht kennt. Auch das endet in
 * „Ungueltiger oder abgelaufener Token".
 *
 * ── Was hier geprueft wird ──────────────────────────────────────────────────
 * Dass der Speicherwert die FUEHRENDE Fassung ist: gesetzt VOR der
 * Schreibung, nicht aus ihr abgeleitet. Genau diese Reihenfolge ist die
 * Behebung; sie steht in zwei Funktionen und laesst sich still umdrehen.
 *
 * Der Test liest Quelltext. Ein echter Nachweis braeuchte ein Geraet, einen
 * DataStore und ein Zeitfenster von Millisekunden — und waere damit ein Test,
 * der manchmal gruen ist. Die REIHENFOLGE dagegen ist eine Tatsache der
 * Datei.
 */
class TokenVorDerSchreibungTest {

    private val quelle = Quellen.ohneKommentare(Quellen.lies("data/PreferencesManager.kt"))

    /** Der Rumpf einer Funktion, bis zur naechsten Deklaration auf ihrer Ebene. */
    private fun rumpf(name: String): String {
        val i = quelle.indexOf("suspend fun $name(")
        assert(i > 0) { "$name gibt es nicht mehr — Muster veraltet?" }
        return quelle.substring(i).lineSequence().drop(1)
            .takeWhile { !it.startsWith("    suspend fun ") && !it.startsWith("    fun ") }
            .joinToString("\n")
    }

    @Test
    fun `der Speicherwert ist die fuehrende Fassung, nicht die abgeleitete`() {
        // Ein `stateIn()` auf diesen beiden waere der alte Zustand: Der Wert
        // folgt der Schreibung, statt ihr vorauszugehen.
        for (name in listOf("serverUrlState", "authTokenState")) {
            assert(quelle.contains("private val _$name = MutableStateFlow")) {
                "$name wird nicht mehr im Speicher gefuehrt — der Interceptor saehe " +
                    "waehrend der DataStore-Schreibung wieder den alten Wert"
            }
        }
        assert(!Regex("""val (serverUrlState|authTokenState): StateFlow<String\?> =\s*\n?\s*\w+\.stateIn""")
            .containsMatchIn(quelle)) {
            "Einer der beiden haengt wieder direkt am DataStore-Fluss"
        }
    }

    @Test
    fun `beide save-Funktionen setzen den Speicherwert vor der Schreibung`() {
        for ((name, feld) in listOf(
            "saveServerUrl" to "_serverUrlState",
            "saveAuthToken" to "_authTokenState",
        )) {
            val r = rumpf(name)
            val speicher = r.indexOf("$feld.value =")
            val platte   = r.indexOf("context.dataStore.edit")
            assert(speicher >= 0) { "$name setzt $feld gar nicht" }
            assert(platte >= 0)   { "$name schreibt nicht mehr in den DataStore — Muster veraltet?" }
            assert(speicher < platte) {
                "$name schreibt erst auf die Platte und setzt $feld danach. Genau in " +
                    "diesem Fenster feuert login() die ersten Anfragen, und der " +
                    "Interceptor liest den alten Wert — Marcos „Ungueltiger oder " +
                    "abgelaufener Token\" bei einer gelungenen Anmeldung."
            }
        }
    }

    @Test
    fun `der DataStore fuellt weiterhin nach`() {
        // Ohne den Nachlauf traegt der Speicherwert nach einem Kaltstart null,
        // und die App waere abgemeldet, obwohl der Token auf der Platte liegt.
        for (fluss in listOf("serverUrl", "authToken")) {
            assert(quelle.contains("prefsScope.launch { $fluss.collect")) {
                "Der Nachlauf aus dem DataStore fehlt fuer $fluss — nach einem " +
                    "Kaltstart bliebe der Wert leer"
            }
        }
    }
}
