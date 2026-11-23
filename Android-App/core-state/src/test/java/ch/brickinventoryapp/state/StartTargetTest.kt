package ch.brickinventoryapp.state

import ch.brickinventoryapp.state.ui.StartTarget
import ch.brickinventoryapp.state.ui.startTarget
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Where the app starts. Whoever still has an http address stored ends up in
 * setup with instructions for https, even with a token present.
 *
 * Counter-check: in startTarget() the condition
 * plaintextLegacyStock() removed → red „eine alte http-Adresse führt in die Einrichtung …“ (SAMMLUNG instead of EINRICHTUNG).
 */
class StartTargetTest {

    @Test
    fun `an old http address leads into the setup, even signed in`() {
        assertEquals(StartTarget.SETUP, startTarget("http://nas:3000", loggedIn = true, development = false))
        assertEquals(StartTarget.SETUP, startTarget("http://192.168.1.50:3000", loggedIn = false, development = false))
        assertEquals("the debug build too only to the device and emulator",
            StartTarget.SETUP, startTarget("http://nas:3000", loggedIn = true, development = true))
    }

    @Test
    fun `with https it continues as before`() {
        assertEquals(StartTarget.SETUP, startTarget("", loggedIn = false, development = false))
        assertEquals(StartTarget.LOGIN, startTarget("https://brick.fritz.box", loggedIn = false, development = false))
        assertEquals(StartTarget.COLLECTION, startTarget("https://brick.fritz.box", loggedIn = true, development = false))
        assertEquals(StartTarget.COLLECTION, startTarget("http://10.0.2.2:3000", loggedIn = true, development = true))
    }
}
