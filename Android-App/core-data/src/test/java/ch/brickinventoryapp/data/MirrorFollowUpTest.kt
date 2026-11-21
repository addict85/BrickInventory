package ch.brickinventoryapp.data

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The mirror of the disk in the PreferencesManager: a value that an own write
 * has already overtaken does not turn the memory back. Otherwise the interceptor
 * briefly holds the old token again after discarding.
 *
 * Counter-check:
 *   in TokenLimit.spiegle() the check `roh(jetzt()) == r` removed → red
 *   “an outdated disk value does not turn the memory back” (was: token-zwischen).
 */
class MirrorFollowUpTest {

    @Test
    fun `an outdated disk value does not turn the memory back`() = runTest {
        val limit = TokenLimit()
        val strom = Channel<String>(Channel.UNLIMITED)
        var platte = "token-alt"
        var speicher: String? = null
        var gelesen = 0
        val spiegel = launch {
            limit.mirror(strom.receiveAsFlow(), { platte }, { it }, { r: String, melde: suspend (String) -> Unit -> melde(r) },
                setze = { speicher = it }, gelesen = { gelesen++ })
        }
        strom.send("token-alt")
        testScheduler.runCurrent()
        assertEquals("Der erste Stand der Platte kommt an", "token-alt", speicher)
        assertEquals(1, gelesen)

        // Discard: memory first, then the disk; the disk's notification comes too late.
        limit.schreibe { speicher = ""; platte = "" }
        strom.send("token-zwischen")
        testScheduler.runCurrent()
        assertEquals("ein überholter Plattenwert dreht den Speicher nicht zurück", "", speicher)

        // A change that did not come via the writes counts.
        platte = "token-fremd"
        strom.send("token-fremd")
        testScheduler.runCurrent()
        assertEquals("token-fremd", speicher)
        assertEquals("gelesen zählt nur den ersten Stand", 1, gelesen)
        spiegel.cancel()
    }
}
