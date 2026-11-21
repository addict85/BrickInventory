package ch.brickinventoryapp.security

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
 *   token-schluessel-ohne-sperre    vaultSpec() ohne setUnlockedDeviceRequired → rot
 *                                   „der Schluessel des Tokens arbeitet nur entsperrt …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class KeystoreVaultTest {

    @Test
    fun `the token's key works only unlocked, those of the stores always`() {
        assertTrue(vaultSpec("token", onlyUnlocked = true).build().isUnlockedDeviceRequired)
        assertFalse("Ausgang und Pins brauchen ihre Schlüssel im Hintergrund",
            vaultSpec("ablage", onlyUnlocked = false).build().isUnlockedDeviceRequired)
    }

    @Test
    fun `the keystore vault never returns unreadable data as plaintext`() {
        // Robolectric hat keinen AndroidKeyStore: Jeder Versuch scheitert, und das darf
        // nur „nicht lesbar“ heissen, nie der Eingabewert.
        assertNull(KeystoreTokenVault("test_alias").entschluessle("klartext-statt-geheimtext"))
    }
}
