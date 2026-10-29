package ch.brickinventoryapp

import org.junit.Test

/**
 * Der Interceptor sieht den neuen Token und die neue Adresse, BEVOR die erste
 * Anfrage hinausgeht: Der Speicherwert ist die führende Fassung, gesetzt vor
 * der Plattenschreibung, und der DataStore füllt ihn nur nach.
 *
 * Quelltext, weil ein echter Nachweis Gerät, DataStore und ein Zeitfenster von
 * Millisekunden bräuchte; die Reihenfolge ist eine Tatsache der Datei.
 *
 * Gegenprobe (29.10.2026): `spiegle(authToken, _authTokenState)` entfernt → rot
 * „der DataStore füllt weiterhin nach“.
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
        for ((fluss, ziel) in listOf("serverUrl" to "_serverUrlState", "authToken" to "_authTokenState")) {
            assert(quelle.contains("spiegle($fluss, $ziel)")) {
                "Der Nachlauf aus dem DataStore fehlt fuer $fluss — nach einem " +
                    "Kaltstart bliebe der Wert leer"
            }
        }
    }
}
