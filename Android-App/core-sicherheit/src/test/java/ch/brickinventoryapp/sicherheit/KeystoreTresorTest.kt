package ch.brickinventoryapp.sicherheit

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Die Keystore-Schlüssel selbst: Der des Tokens arbeitet nur am entsperrten Gerät,
 * und was der Keystore nicht öffnen kann, kommt nie als Klartext zurück.
 *
 * Gegenproben (Robolectric, misst die CI; Job `gegenproben`):
 *   token-schluessel-ohne-sperre    tresorSpezifikation() ohne setUnlockedDeviceRequired → rot
 *                                   „der Schluessel des Tokens arbeitet nur entsperrt …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class KeystoreTresorTest {

    @Test
    fun `der Schluessel des Tokens arbeitet nur entsperrt, die der Ablagen immer`() {
        assertTrue(tresorSpezifikation("token", nurEntsperrt = true).build().isUnlockedDeviceRequired)
        assertFalse("Ausgang und Pins brauchen ihre Schlüssel im Hintergrund",
            tresorSpezifikation("ablage", nurEntsperrt = false).build().isUnlockedDeviceRequired)
    }

    @Test
    fun `der Keystore-Tresor gibt Unlesbares nie als Klartext zurueck`() {
        // Robolectric hat keinen AndroidKeyStore: Jeder Versuch scheitert, und das darf
        // nur „nicht lesbar“ heissen, nie der Eingabewert.
        assertNull(KeystoreTokenTresor("test_alias").entschluessle("klartext-statt-geheimtext"))
    }
}
