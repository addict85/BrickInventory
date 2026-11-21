package ch.brickinventoryapp.data

import ch.brickinventoryapp.security.Vertrauenschiffre
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException

/**
 * Ein Abmeldeauftrag liegt in der Datenbank von WorkManager nur als ein Geheimtext unter
 * dem Schlüssel der Angaben: Adresse, Pin und Herkunft stehen nicht lesbar darin. Bei
 * gesperrtem Gerät wartet er, statt aufzugeben.
 *
 * Gegenproben (kotlinc und JUnit lokal):
 *   A  ablegen() gibt den Text unverschlüsselt zurück → rot „der Auftrag liegt nur
 *      verschluesselt …“; gegenproben/auftrag-im-klartext.patch
 *   B  lies() macht aus Gesperrt Unlesbar → rot „gesperrt wartet der Auftrag …“;
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
