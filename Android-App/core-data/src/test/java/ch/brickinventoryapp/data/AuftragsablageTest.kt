package ch.brickinventoryapp.data

import ch.brickinventoryapp.security.Vertrauenschiffre
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException

/**
 * A sign-out job lies in WorkManager's database only as one ciphertext under
 * the details' key: address, pin and origin are not readable in it. With a
 * locked device it waits instead of giving up.
 *
 * Counter-checks (kotlinc and JUnit locally):
 *   A  ablegen() returns the text unencrypted → red “the job lies in the queue only
 *      encrypted …”; gegenproben/auftrag-im-klartext.patch
 *   B  lies() turns Gesperrt into Unlesbar → red “locked the job waits …”;
 *      gegenproben/auftrag-gesperrt-aufgegeben.patch
 */
class AuftragsablageTest {

    private var gesperrt = false
    private val cipher = Vertrauenschiffre(angaben = {
        if (gesperrt) throw IOException("Keystore gerade nicht bereit")
        ByteArray(32) { 5 }
    }) { ByteArray(32) { 6 } }
    private val ablage = Auftragsablage(cipher::verschluessleDetail, cipher::openDetail)

    private val job = Entwertungsauftrag(
        "https://brick.example.org:8443/inventar", "e1:R0VIRUlNVEVYVA==", "sha256/AAAABBBBCCCC=", "https://brick.example.org:8443",
    )

    @Test
    fun `the job lies in the queue only encrypted and comes back whole`() {
        val geheim = ablage.ablegen(job)!!
        for (teil in listOf("brick", "example", "8443", "inventar", "R0VIRUlNVEVYVA", "AAAABBBBCCCC"))
            assertFalse("„$teil“ steht lesbar im Auftrag: $geheim", teil in geheim)
        assertEquals(JobState.Da(job), ablage.lies(geheim))

        val ohne = Entwertungsauftrag("https://nas.local", "e1:WA==", pin = null)
        assertEquals("Ohne Pin, Herkunft wie der Server", JobState.Da(ohne), ablage.lies(ablage.ablegen(ohne)!!))
    }

    @Test
    fun `locked the job waits, a foreign or broken one yields nothing`() {
        val geheim = ablage.ablegen(job)!!
        gesperrt = true
        assertEquals(JobState.Gesperrt, ablage.lies(geheim))
        assertNull("Gesperrt wird nichts in die Warteschlange gelegt", ablage.ablegen(job))
        gesperrt = false
        assertEquals(JobState.Unlesbar, ablage.lies("kein-base64-%%%"))
        assertEquals("Unter anderem Namen gilt er nicht", JobState.Unlesbar,
            ablage.lies(cipher.verschluessleDetail("1\nhttps://x\nt\n\n", "server_url")!!))
        assertEquals("Eine unbekannte Form gilt nicht", JobState.Unlesbar,
            ablage.lies(cipher.verschluessleDetail("2\nhttps://x\nt\n\n", "entwertungsauftrag")!!))
    }
}
