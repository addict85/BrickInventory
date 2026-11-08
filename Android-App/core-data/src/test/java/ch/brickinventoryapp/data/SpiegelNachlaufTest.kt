package ch.brickinventoryapp.data

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Der Spiegel der Platte im PreferencesManager: Ein Wert, den eine eigene Schreibung
 * schon überholt hat, dreht den Speicher nicht zurück. Sonst hält der Interceptor
 * nach dem Verwerfen kurz wieder den alten Token.
 *
 * Gegenprobe:
 *   in TokenSchranke.spiegle() die Prüfung `roh(jetzt()) == r` entfernt → rot
 *   „ein überholter Plattenwert dreht den Speicher nicht zurück“ (war: token-zwischen).
 */
class SpiegelNachlaufTest {

    @Test
    fun `ein ueberholter Plattenwert dreht den Speicher nicht zurueck`() = runTest {
        val schranke = TokenSchranke()
        val strom = Channel<String>(Channel.UNLIMITED)
        var platte = "token-alt"
        var speicher: String? = null
        var gelesen = 0
        val spiegel = launch {
            schranke.spiegle(strom.receiveAsFlow(), { platte }, { it }, { r: String, melde: suspend (String) -> Unit -> melde(r) },
                setze = { speicher = it }, gelesen = { gelesen++ })
        }
        strom.send("token-alt")
        testScheduler.runCurrent()
        assertEquals("Der erste Stand der Platte kommt an", "token-alt", speicher)
        assertEquals(1, gelesen)

        // Verwerfen: Speicher zuerst, dann die Platte; die Meldung der Platte kommt zu spät.
        schranke.schreibe { speicher = ""; platte = "" }
        strom.send("token-zwischen")
        testScheduler.runCurrent()
        assertEquals("ein überholter Plattenwert dreht den Speicher nicht zurück", "", speicher)

        // Eine Änderung, die nicht über die Schreibungen kam, gilt.
        platte = "token-fremd"
        strom.send("token-fremd")
        testScheduler.runCurrent()
        assertEquals("token-fremd", speicher)
        assertEquals("gelesen zählt nur den ersten Stand", 1, gelesen)
        spiegel.cancel()
    }
}
