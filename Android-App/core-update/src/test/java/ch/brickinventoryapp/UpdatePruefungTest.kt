package ch.brickinventoryapp

import ch.brickinventoryapp.util.Signatur
import ch.brickinventoryapp.util.liegtUnter
import ch.brickinventoryapp.util.signaturFolgt
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die beiden Prüfungen des Selbst-Updaters ohne Android: Liegt die Adresse aus
 * version.json in unserer Release-Ablage, und darf die Signatur des geladenen APK
 * die laufende ersetzen (auch nach einer Schlüsselrotation)?
 *
 * Gegenproben:
 *   A  in liegtUnter() den Vergleich des Hosts entfernt → rot „nur Adressen in
 *      der Release-Ablage“ (fremder Host mit gleichem Pfad)
 *   B  in liegtUnter() `ziel.pathSegments.size == ordner.size + 1` entfernt →
 *      rot „nur Adressen in der Release-Ablage“ (Unterordner)
 *   C  signaturFolgt() als `alt.aktuell == neu.aktuell` → rot „ein rotierter
 *      Schluessel mit dem laufenden in der Ahnenreihe passt“
 *   D  im Zweig mit einem Signierer die Ahnenreihe des ALTEN geprüft
 *      (`neu.aktuell.single() in alt.ahnen`) → rot „ein Rueckschritt …“
 */
class UpdatePruefungTest {

    private val basis = "https://github.com/addict85/BrickInventory/releases/download/apk-neuste"

    @Test
    fun `nur Adressen in der Release-Ablage`() {
        assertTrue(liegtUnter("$basis/BrickInventory.apk", basis))
        for (fremd in listOf(
            "$basis.angreifer.tld/x.apk",
            "https://angreifer.tld/addict85/BrickInventory/releases/download/apk-neuste/BrickInventory.apk",
            "http://github.com/addict85/BrickInventory/releases/download/apk-neuste/BrickInventory.apk",
            "$basis/../apk-alt/BrickInventory.apk",
            "$basis/unter/BrickInventory.apk",
            "$basis/version.json",
            "$basis/.apk",
            "https://nutzer@github.com/addict85/BrickInventory/releases/download/apk-neuste/BrickInventory.apk",
            "https://github.com:8443/addict85/BrickInventory/releases/download/apk-neuste/BrickInventory.apk",
            "$basis/BrickInventory.apk?x=1",
            "$basis/BrickInventory.apk#x",
            "kein url",
        )) assertFalse(fremd, liegtUnter(fremd, basis))
    }

    @Test
    fun `derselbe Schluessel passt, ein fremder nicht`() {
        assertTrue(signaturFolgt(Signatur(setOf("k1"), listOf("k1")), Signatur(setOf("k1"), listOf("k1"))))
        assertFalse(signaturFolgt(Signatur(setOf("k1"), listOf("k1")), Signatur(setOf("x"), listOf("x"))))
        assertFalse("Unbekannt ist nie passend", signaturFolgt(Signatur(emptySet(), emptyList()), Signatur(emptySet(), emptyList())))
    }

    @Test
    fun `ein rotierter Schluessel mit dem laufenden in der Ahnenreihe passt`() {
        assertTrue(signaturFolgt(Signatur(setOf("k1"), listOf("k1")), Signatur(setOf("k2"), listOf("k1", "k2"))))
        assertFalse("Fremde Ahnenreihe", signaturFolgt(Signatur(setOf("k1"), listOf("k1")), Signatur(setOf("k2"), listOf("x", "k2"))))
    }

    @Test
    fun `ein Rueckschritt auf den alten Schluessel passt nicht`() {
        assertFalse(signaturFolgt(Signatur(setOf("k2"), listOf("k1", "k2")), Signatur(setOf("k1"), listOf("k1"))))
    }

    @Test
    fun `mehrere Signierer muessen genau stimmen`() {
        assertTrue(signaturFolgt(Signatur(setOf("a", "b"), listOf("a", "b")), Signatur(setOf("b", "a"), listOf("b", "a"))))
        assertFalse(signaturFolgt(Signatur(setOf("a", "b"), listOf("a", "b")), Signatur(setOf("a"), listOf("a", "b"))))
    }
}
