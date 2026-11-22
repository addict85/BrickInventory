package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.util.Signature
import ch.brickinventoryapp.update.util.isBelow
import ch.brickinventoryapp.update.util.signatureFollows
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The self-updater's two checks without Android: does the address from
 * version.json sit in our release store, and may the loaded APK's signature
 * replace the running one (even after a key rotation)?
 *
 * Counter-checks:
 *   A  the host comparison removed from isBelow() → red „nur Adressen in
 *      der Release-Ablage“ (foreign host with the same path)
 *   B  `target.pathSegments.size == folder.size + 1` removed from isBelow() →
 *      red „only addresses in the release store“ (subfolder)
 *   C  signatureFollows() as `old.current == newValue.current` → red „ein rotierter
 *      Schluessel mit dem laufenden in der Ahnenreihe passt“
 *   D  in the single-signer branch the OLD one's ancestry checked
 *      (`newValue.current.single() in old.ancestors`) → red „ein Rueckschritt …“
 */
class UpdateCheckTest {

    private val basis = "https://github.com/addict85/BrickInventory/releases/latest/download"

    @Test
    fun `only addresses in the release store`() {
        assertTrue(isBelow("$basis/BrickInventory.apk", basis))
        for (foreign in listOf(
            "$basis.angreifer.tld/x.apk",
            "https://angreifer.tld/addict85/BrickInventory/releases/latest/download/BrickInventory.apk",
            "http://github.com/addict85/BrickInventory/releases/latest/download/BrickInventory.apk",
            "$basis/../apk-alt/BrickInventory.apk",
            "$basis/unter/BrickInventory.apk",
            "$basis/version.json",
            "$basis/.apk",
            "https://nutzer@github.com/addict85/BrickInventory/releases/latest/download/BrickInventory.apk",
            "https://github.com:8443/addict85/BrickInventory/releases/latest/download/BrickInventory.apk",
            "$basis/BrickInventory.apk?x=1",
            "$basis/BrickInventory.apk#x",
            "kein url",
        )) assertFalse(foreign, isBelow(foreign, basis))
    }

    @Test
    fun `the same key matches, a foreign one does not`() {
        assertTrue(signatureFollows(Signature(setOf("k1"), listOf("k1")), Signature(setOf("k1"), listOf("k1"))))
        assertFalse(signatureFollows(Signature(setOf("k1"), listOf("k1")), Signature(setOf("x"), listOf("x"))))
        assertFalse("Unbekannt ist nie passend", signatureFollows(Signature(emptySet(), emptyList()), Signature(emptySet(), emptyList())))
    }

    @Test
    fun `a rotated key with the running one in the lineage matches`() {
        assertTrue(signatureFollows(Signature(setOf("k1"), listOf("k1")), Signature(setOf("k2"), listOf("k1", "k2"))))
        assertFalse("Fremde Ahnenreihe", signatureFollows(Signature(setOf("k1"), listOf("k1")), Signature(setOf("k2"), listOf("x", "k2"))))
    }

    @Test
    fun `a step back to the old key does not match`() {
        assertFalse(signatureFollows(Signature(setOf("k2"), listOf("k1", "k2")), Signature(setOf("k1"), listOf("k1"))))
    }

    @Test
    fun `several signers must match exactly`() {
        assertTrue(signatureFollows(Signature(setOf("a", "b"), listOf("a", "b")), Signature(setOf("b", "a"), listOf("b", "a"))))
        assertFalse(signatureFollows(Signature(setOf("a", "b"), listOf("a", "b")), Signature(setOf("a"), listOf("a", "b"))))
    }
}
