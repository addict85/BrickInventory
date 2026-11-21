package ch.brickinventoryapp.security

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import android.security.keystore.KeyPermanentlyInvalidatedException
import java.security.InvalidKeyException
import java.security.KeyStoreException
import java.security.ProviderException
import java.security.UnrecoverableKeyException
import javax.crypto.AEADBadTagException
import javax.crypto.BadPaddingException

/**
 * Ein vorübergehender Keystore-Fehler meldet nicht ab. Bisher ergab
 * jede Ausnahme beim Entschlüsseln „kein Token“, auch ein KeyStoreException beim
 * Hochfahren oder ein hängender StrongBox-Chip.
 *
 * Gegenproben:
 *   A  vaultErrorPermanent() immer true (der alte Stand: jeder Fehler = weg) →
 *      rot „only a permanent error means token gone“ und „ein vorübergehender
 *      Fehler wird einmal wiederholt“
 *   B  openWithRetry() mit `repeat(1)` → rot „… wird einmal wiederholt“
 *   C  readToken() meldet bei Gesperrt sofort „“ (`melde(alt ?: ""); return`) →
 *      rot „ein gesperrter Keystore beim Start …“ und „… nachgemeldet“
 *   D  readToken() hört nach dem Anlauf auf (`return` nach dem ersten „“) → rot
 *      „ein länger gesperrter Keystore meldet das Token nach“
 * Gegenproben zum Schlüssel, der nur bei entsperrtem Gerät arbeitet (lokal gemessen):
 *   E  readToken() zählt jeden Versuch (`attempt++` ohne Bedingung) → rot „bei
 *      gesperrtem Geraet wartet das Lesen …“; gegenproben/sperre-zaehlt-versuche.patch
 *   G  EntsperrVault.oeffne() immer über `onlyUnlocked` → rot „ein Geheimtext ohne
 *      Praefix …“; gegenproben/entsperrtresor-vergisst-altbestand.patch
 * Dass EntsperrVault nie auf den Schlüssel ohne Bedingung ausweicht, prüft StoreUnlockedTest.
 */
class VaultLockTest {

    @Test
    fun `only a permanent error means token gone`() {
        for (e in listOf(AEADBadTagException("tag"), BadPaddingException("x"),
                         KeyPermanentlyInvalidatedException("neu eingerichtet"),
                         UnrecoverableKeyException("x"), IllegalArgumentException("base64"))) {
            assertTrue("$e", vaultErrorPermanent(e))
        }
        for (e in listOf(KeyStoreException("beim Hochfahren"), ProviderException("StrongBox"),
                         InvalidKeyException("Keystore nicht bereit"), IllegalStateException("x"),
                         RuntimeException("x"))) {
            assertFalse("$e", vaultErrorPermanent(e))
        }
    }

    @Test
    fun `a temporary error is retried once, a permanent one is not`() {
        var n = 0
        assertEquals(Tresorbefund.Readable("t"), openWithRetry {
            if (n++ == 0) throw KeyStoreException("kurz") else "t"
        })
        n = 0
        assertEquals(Tresorbefund.Gesperrt, openWithRetry { n++; throw ProviderException("haengt") })
        assertEquals(2, n)
        n = 0
        assertEquals(Tresorbefund.Weg, openWithRetry { n++; throw AEADBadTagException() })
        assertEquals("Kein zweiter Versuch bei einem falschen Schlüssel", 1, n)
        assertEquals(Tresorbefund.Weg, openWithRetry { null })
    }

    /** Liefert der Reihe nach [findings], danach immer den letzten. */
    private class Sequence(vararg findings: Tresorbefund) : TokenEncryption {
        private val rest = ArrayDeque(findings.toList())
        override fun verschluessle(klartext: String) = klartext
        override fun entschluessle(gespeichert: String): String? = null
        override fun oeffne(gespeichert: String): Tresorbefund = if (rest.size > 1) rest.removeFirst() else rest.first()
    }

    private fun lies(
        tresor: TokenEncryption,
        alt: String? = null,
        lock: Geraetesperre = Geraetesperre { false },
    ): Pair<List<String>, List<Long>> {
        val gemeldet = mutableListOf<String>()
        val pausen = mutableListOf<Long>()
        runBlocking { readToken(tresor, "geheim", alt, melde = { gemeldet += it }, wait = { pausen += it }, lock = lock) }
        return gemeldet to pausen
    }

    /**
     * Eine Nacht gesperrt: weit mehr Versuche, als der Nachlauf erlaubt. Danach entsperrt
     * und lesbar; das Token muss zurückkommen, sonst stünde morgens die Anmeldemaske da.
     */
    @Test
    fun `with a locked device reading waits without a deadline and reports the token after unlocking`() {
        val night = VAULT_ATTEMPT_MS.size + VAULT_FOLLOW_UP_ATTEMPTS + 50
        var gelesen = 0
        val tresor = object : TokenEncryption {
            override fun verschluessle(klartext: String) = klartext
            override fun entschluessle(gespeichert: String): String? = null
            override fun oeffne(gespeichert: String): Tresorbefund =
                if (gelesen++ < night) Tresorbefund.Gesperrt else Tresorbefund.Readable("token")
        }
        val (gemeldet, pausen) = lies(tresor, lock = { gelesen < night })
        assertEquals("Einmal leer, dann das Token", listOf("", "token"), gemeldet)
        assertEquals(night, pausen.size)
    }

    private class Attrappe(val name: String, val gesperrt: () -> Boolean = { false }) : TokenEncryption {
        override fun verschluessle(klartext: String): String {
            if (gesperrt()) throw InvalidKeyException("Gerät gesperrt")
            return "$name(" + klartext.reversed() + ")"
        }
        override fun entschluessle(gespeichert: String): String? =
            gespeichert.takeIf { it.startsWith("$name(") }?.removePrefix("$name(")?.removeSuffix(")")?.reversed()
    }

    @Test
    fun `the unlock vault stores under the strict key and recognizes the legacy stock`() {
        val tresor = EntsperrVault(Attrappe("streng"), Attrappe("immer"))
        val geheim = tresor.verschluessle("token")
        assertTrue(geheim, geheim.contains("streng("))
        assertFalse(tresor.veraltet(geheim))
        assertEquals(Tresorbefund.Readable("token"), tresor.oeffne(geheim))
    }

    @Test
    fun `a ciphertext without prefix stays readable via the old key`() {
        val tresor = EntsperrVault(Attrappe("streng"), Attrappe("immer"))
        assertEquals(Tresorbefund.Readable("alt"), tresor.oeffne("immer(tla)"))
        assertTrue(tresor.veraltet("immer(tla)"))
    }

    @Test
    fun `a locked keystore at start is waited for, without signing out`() {
        val (gemeldet, pausen) = lies(Sequence(Tresorbefund.Gesperrt, Tresorbefund.Gesperrt, Tresorbefund.Readable("token")))
        assertEquals("Kein leeres Token vor dem echten", listOf("token"), gemeldet)
        assertEquals(VAULT_ATTEMPT_MS.take(2), pausen)
        assertTrue("Der Anlauf bleibt unter der Wartezeit des Wächters (5 s)", VAULT_ATTEMPT_MS.sum() < 5_000)
    }

    @Test
    fun `a keystore locked for longer reports the token afterwards`() {
        val sperren = Array<Tresorbefund>(VAULT_ATTEMPT_MS.size + 3) { Tresorbefund.Gesperrt }
        val (gemeldet, pausen) = lies(Sequence(*sperren, Tresorbefund.Readable("token")))
        assertEquals("Erst die Anmeldemaske, dann wieder angemeldet", listOf("", "token"), gemeldet)
        assertEquals(VAULT_ATTEMPT_MS + List(3) { VAULT_FOLLOW_UP_MS }, pausen)
    }

    @Test
    fun `a permanently locked keystore gives up eventually, a missing key immediately`() {
        val (gemeldet, pausen) = lies(Sequence(Tresorbefund.Gesperrt))
        assertEquals(listOf(""), gemeldet)
        assertTrue("Höchstens zehn Minuten: ${pausen.sum()}", pausen.sum() <= 10 * 60_000L + VAULT_ATTEMPT_MS.sum())
        assertEquals(listOf("alt") to emptyList<Long>(), lies(Sequence(Tresorbefund.Weg), alt = "alt"))
    }
}
