package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.components.AppUnlocking
import ch.brickinventoryapp.ui.components.StepApproval
import ch.brickinventoryapp.ui.components.UnlockKey
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
 *      „ungueltiger Schluessel …“; counter-checks/app-lock-without-crypto.patch
 *   B  no new key after a failed signature → red „ungueltiger Schluessel …“;
 *      counter-checks/app-lock-without-new-key.patch
 *   C  asking without end → red „fremd signiert …“ (third retry);
 *      counter-checks/app-lock-asks-endlessly.patch
 */
class AppUnlockingTest {

    private fun pair() = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    private fun signature(with: PrivateKey) =
        Signature.getInstance(StepApproval.SIGNATURE_SCHEME).apply { initSign(with) }

    private inner class Key : UnlockKey {
        var pair = pair()
        var discarded = 0
        var missing = false
        override fun signature() = if (missing) error("no keystore") else signature(pair.private)
        override fun public() = pair.public
        override fun discard() { discarded++; pair = pair() }
    }

    private val key = Key()
    private var unlocked = 0

    /** Answers every retry with the next answer; after that like a cancellation. */
    private fun jobRun(vararg responses: (Signature) -> Signature?): Int {
        var ask = 0
        AppUnlocking(key) { s, response -> responses.getOrNull(ask++)?.let { response(it(s)) } ?: response(null) }
            .unlock { unlocked++ }
        return ask
    }

    @Test
    fun `the authorized signature unlocks`() {
        assertEquals(1, jobRun({ it }))
        assertEquals(1, unlocked)
    }

    @Test
    fun `success without a signature does not unlock and does not ask again`() {
        assertEquals(1, jobRun({ null }))
        assertEquals(0, unlocked)
        assertEquals(0, key.discarded)
    }

    @Test
    fun `foreign-signed does not unlock and asks only once more`() {
        val foreign = pair()
        assertEquals(2, jobRun({ signature(foreign.private) }, { signature(foreign.private) }, { signature(foreign.private) }))
        assertEquals(0, unlocked)
    }

    @Test
    fun `an invalid key is replaced and asked once more`() {
        // A signature made for verifying rather than signing fails at sign() like an invalidated key.
        val canNot: (Signature) -> Signature? = {
            Signature.getInstance(StepApproval.SIGNATURE_SCHEME).apply { initVerify(key.pair.public) }
        }
        assertEquals(2, jobRun(canNot, { it }))
        assertEquals(1, key.discarded)
        assertEquals(1, unlocked)
    }

    @Test
    fun `without a key the app stays locked`() {
        key.missing = true
        assertEquals(0, jobRun({ it }))
        assertEquals(0, unlocked)
    }
}
