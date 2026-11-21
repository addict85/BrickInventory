package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.local.Abgleichsergebnis
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The outbox with a locked device: the token has then merely not been read yet (its
 * key only works unlocked). The worker tries again later
 * instead of finishing the run as done; the items would otherwise lie until the
 * next occasion.
 *
 * Counter-check (measured locally via an excerpt): nochmal() with `NOT_SIGNED_IN -> false` → red “without a token on a
 * locked device …”; gegenproben/ausgang-ohne-token-fertig.patch
 */
class ExitLockTest {

    @Test
    fun `without a token on a locked device the exit tries again later`() {
        assertTrue(Abgleichsergebnis.NOT_SIGNED_IN.again(deviceLocked = true))
        assertFalse("Abgemeldet bleibt der Lauf erledigt", Abgleichsergebnis.NOT_SIGNED_IN.again(deviceLocked = false))
    }

    @Test
    fun `done and later do not depend on the lock`() {
        for (gesperrt in listOf(true, false)) {
            assertTrue(Abgleichsergebnis.LATER.again(gesperrt))
            assertFalse(Abgleichsergebnis.FERTIG.again(gesperrt))
        }
    }
}
