package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.util.Signatur
import ch.brickinventoryapp.update.util.liesBelow
import ch.brickinventoryapp.update.util.signatureFollows
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die beiden Prüfungen des Selbst-Updaters ohne Android: Liegt die Adresse aus
 * version.json in unserer Release-Ablage, und darf die Signatur des geladenen APK
 * die laufende ersetzen (auch nach einer Schlüsselrotation)?
 *
 * Gegenproben:
 *   A  in liesBelow() den Vergleich des Hosts entfernt → rot „nur Adressen in
 *      der Release-Ablage“ (fremder Host mit gleichem Pfad)
 *   B  in liesBelow() `ziel.pathSegments.size == folder.size + 1` entfernt →
 *      rot „nur Adressen in der Release-Ablage“ (Unterordner)
 *   C  signatureFollows() als `alt.aktuell == neu.aktuell` → rot „ein rotierter
 *      Schluessel mit dem laufenden in der Ahnenreihe passt“
 *   D  im Zweig mit einem Signierer die Ahnenreihe des ALTEN geprüft
 *      (`neu.aktuell.single() in alt.ancestors`) → rot „ein Rueckschritt …“
 */
class UpdateCheckTest {

    private val basis = "https://github.com/addict85/BrickInventory/releases/latest/download"

    @Test
    fun `nur Adressen in der Release-Ablage`() {
        assertTrue(liesBelow("$basis/BrickInventory.apk", basis))
        for (fremd in listOf(
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
        )) assertFalse(fremd, liesBelow(fremd, basis))
    }

    @Test
    fun `derselbe Schluessel passt, ein fremder nicht`() {
        assertTrue(signatureFollows(Signatur(setOf("k1"), listOf("k1")), Signatur(setOf("k1"), listOf("k1"))))
        assertFalse(signatureFollows(Signatur(setOf("k1"), listOf("k1")), Signatur(setOf("x"), listOf("x"))))
        assertFalse("Unbekannt ist nie passend", signatureFollows(Signatur(emptySet(), emptyList()), Signatur(emptySet(), emptyList())))
    }

    @Test
    fun `ein rotierter Schluessel mit dem laufenden in der Ahnenreihe passt`() {
        assertTrue(signatureFollows(Signatur(setOf("k1"), listOf("k1")), Signatur(setOf("k2"), listOf("k1", "k2"))))
        assertFalse("Fremde Ahnenreihe", signatureFollows(Signatur(setOf("k1"), listOf("k1")), Signatur(setOf("k2"), listOf("x", "k2"))))
    }

    @Test
    fun `ein Rueckschritt auf den alten Schluessel passt nicht`() {
        assertFalse(signatureFollows(Signatur(setOf("k2"), listOf("k1", "k2")), Signatur(setOf("k1"), listOf("k1"))))
    }

    @Test
    fun `mehrere Signierer muessen genau stimmen`() {
        assertTrue(signatureFollows(Signatur(setOf("a", "b"), listOf("a", "b")), Signatur(setOf("b", "a"), listOf("b", "a"))))
        assertFalse(signatureFollows(Signatur(setOf("a", "b"), listOf("a", "b")), Signatur(setOf("a"), listOf("a", "b"))))
    }
}
