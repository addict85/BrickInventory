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
 *   in TokenLimit.spiegle() the check `raw(now()) == r` removed → red
 *   “an outdated disk value does not turn the memory back” (was: token-zwischen).
 */
class MirrorFollowUpTest {

    @Test
    fun `an outdated disk value does not turn the memory back`() = runTest {
        val limit = TokenLimit()
        val stream = Channel<String>(Channel.UNLIMITED)
        var plate = "token-alt"
        var memory: String? = null
        var onRead = 0
        val mirror = launch {
            limit.mirror(stream.receiveAsFlow(), { plate }, { it }, { r: String, report: suspend (String) -> Unit -> report(r) },
                set = { memory = it }, onRead = { onRead++ })
        }
        stream.send("token-alt")
        testScheduler.runCurrent()
        assertEquals("Der erste Stand der Platte kommt an", "token-alt", memory)
        assertEquals(1, onRead)

        // Discard: memory first, then the disk; the disk's notification comes too late.
        limit.write { memory = ""; plate = "" }
        stream.send("token-zwischen")
        testScheduler.runCurrent()
        assertEquals("ein überholter Plattenwert dreht den Speicher nicht zurück", "", memory)

        // A change that did not come via the writes counts.
        plate = "token-fremd"
        stream.send("token-fremd")
        testScheduler.runCurrent()
        assertEquals("token-fremd", memory)
        assertEquals("gelesen zählt nur den ersten Stand", 1, onRead)
        mirror.cancel()
    }
}
