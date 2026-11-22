package ch.brickinventoryapp.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The Keystore keys themselves: the token's only works on an unlocked device,
 * and whatever the Keystore can't open never comes back as plaintext.
 *
 * Counter-checks (Robolectric, measured by CI; job `counter-checks`):
 *   token-schluessel-ohne-sperre    vaultSpec() without setUnlockedDeviceRequired → red
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
        // Robolectric has no AndroidKeyStore: every attempt fails, and that may
        // only mean „unreadable“, never the input value.
        assertNull(KeystoreTokenVault("test_alias").decrypt("klartext-statt-geheimtext"))
    }
}
