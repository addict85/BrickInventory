package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.AppUnlocking
import ch.brickinventoryapp.ui.components.Entsperrschluessel
import ch.brickinventoryapp.ui.components.Schrittfreigabe
import org.junit.Assert.assertEquals
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * The app lock only yields to a signature from its own key, not to the
 * success callback alone; an invalidated key is replaced and asked exactly once.
 * The keystore here acts as a software EC key, and
 * „nicht freigegeben“ is a signature that cannot sign or signs with someone else's key.
 *
 * Counter-checks (measured locally with kotlinc on Nov 9, 2026):
 *   A  any existing signature unlocks without signing → red „fremd signiert …“ and
 *      „ungueltiger Schluessel …“; gegenproben/app-sperre-ohne-krypto.patch
 *   B  no new key after a failed signature → red „ungueltiger Schluessel …“;
 *      gegenproben/app-sperre-ohne-neuen-schluessel.patch
 *   C  asking without end → red „fremd signiert …“ (third retry);
 *      gegenproben/app-sperre-fragt-ohne-ende.patch
 */
class AppUnlockingTest {

    private fun paar() = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    private fun signatur(mit: PrivateKey) =
        Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).apply { initSign(mit) }

    private inner class Schluessel : Entsperrschluessel {
        var paar = paar()
        var verworfen = 0
        var fehlt = false
        override fun signatur() = if (fehlt) error("kein Keystore") else signatur(paar.private)
        override fun oeffentlich() = paar.public
        override fun discard() { verworfen++; paar = paar() }
    }

    private val schluessel = Schluessel()
    private var entsperrt = 0

    /** Answers every retry with the next answer; after that like a cancellation. */
    private fun lauf(vararg antworten: (Signature) -> Signature?): Int {
        var fragen = 0
        AppUnlocking(schluessel) { s, antwort -> antworten.getOrNull(fragen++)?.let { antwort(it(s)) } ?: antwort(null) }
            .unlock { entsperrt++ }
        return fragen
    }

    @Test
    fun `the authorized signature unlocks`() {
        assertEquals(1, lauf({ it }))
        assertEquals(1, entsperrt)
    }

    @Test
    fun `success without a signature does not unlock and does not ask again`() {
        assertEquals(1, lauf({ null }))
        assertEquals(0, entsperrt)
        assertEquals(0, schluessel.verworfen)
    }

    @Test
    fun `foreign-signed does not unlock and asks only once more`() {
        val fremd = paar()
        assertEquals(2, lauf({ signatur(fremd.private) }, { signatur(fremd.private) }, { signatur(fremd.private) }))
        assertEquals(0, entsperrt)
    }

    @Test
    fun `an invalid key is replaced and asked once more`() {
        // A signature made for verifying rather than signing fails at sign() like an invalidated key.
        val canNot: (Signature) -> Signature? = {
            Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).apply { initVerify(schluessel.paar.public) }
        }
        assertEquals(2, lauf(canNot, { it }))
        assertEquals(1, schluessel.verworfen)
        assertEquals(1, entsperrt)
    }

    @Test
    fun `without a key the app stays locked`() {
        schluessel.fehlt = true
        assertEquals(0, lauf({ it }))
        assertEquals(0, entsperrt)
    }
}
