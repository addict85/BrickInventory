package ch.brickinventoryapp

import ch.brickinventoryapp.util.NetworkPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Die Network-Security-Config ist die zweite Linie hinter dem Wächter: Im
 * Release-Build verbietet sie Klartext überall, im Debug-Build erlaubt sie ihn
 * genau zu den Hosts, die auch der Wächter durchlässt.
 *
 * Gegenproben (01.11.2026, gemessen):
 *   A  in src/main die base-config wieder auf cleartextTrafficPermitted="true" →
 *      rot „der Release-Build erlaubt nirgends Klartext“
 *   B  in src/debug einen weiteren Host (192.168.1.50) mit Klartext → rot „der
 *      Debug-Build erlaubt Klartext nur …“
 *   C  in src/main ein <certificates src="user" /> → rot „beide Fassungen
 *      vertrauen nur System-CAs“
 *   D  in data_extraction_rules.xml unter device-transfer die Zeile widget.xml
 *      entfernt → rot „Kontodaten verlassen das Geraet nicht“
 *   E  in backup_rules.xml die Zeile files/vorschau entfernt → rot (dieselbe Prüfung)
 *   F  (02.11.2026) in backup_rules.xml die Zeile design_spiegel.xml entfernt →
 *      rot „Kontodaten verlassen das Geraet nicht“ (Pins, Schalter Nutzer-CA)
 */
class NetzsicherheitTest {

    private fun lies(variante: String): Element {
        val f = File(Quellen.projekt, "app/src/$variante/res/xml/network_security_config.xml")
        assertTrue("$f fehlt", f.isFile)
        return DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(f).documentElement
    }

    private fun Element.kinder(name: String): List<Element> =
        (0 until childNodes.length).map { childNodes.item(it) }.filterIsInstance<Element>().filter { it.tagName == name }

    private fun Element.alle(name: String): List<Element> =
        getElementsByTagName(name).let { l -> (0 until l.length).map { l.item(it) as Element } }

    @Test
    fun `der Release-Build erlaubt nirgends Klartext`() {
        val cfg = lies("main")
        val basis = cfg.kinder("base-config").single()
        assertEquals("false", basis.getAttribute("cleartextTrafficPermitted"))
        val erlaubt = (cfg.kinder("domain-config") + basis).filter { it.getAttribute("cleartextTrafficPermitted") != "false" }
        assertTrue("Klartext erlaubt in: " + erlaubt.map { it.tagName }, erlaubt.isEmpty())
        assertTrue("Unterdrückte Lint-Warnung", !cfg.hasAttribute("xmlns:tools"))
    }

    @Test
    fun `der Debug-Build erlaubt Klartext nur zum Geraet und zum Emulator-Host`() {
        val cfg = lies("debug")
        assertEquals("false", cfg.kinder("base-config").single().getAttribute("cleartextTrafficPermitted"))
        val klartext = cfg.kinder("domain-config").filter { it.getAttribute("cleartextTrafficPermitted") == "true" }
        val hosts = klartext.flatMap { it.kinder("domain") }
        assertEquals(NetworkPolicy.ENTWICKLUNGS_HOSTS, hosts.map { it.textContent.trim() }.toSet())
        assertTrue("Ohne Unterdomänen", hosts.all { it.getAttribute("includeSubdomains") == "false" })
    }

    @Test
    fun `beide Fassungen vertrauen nur System-CAs`() {
        for (variante in listOf("main", "debug")) {
            val quellen = lies(variante).alle("certificates").map { it.getAttribute("src") }
            assertTrue("$variante: $quellen", quellen.isNotEmpty() && quellen.all { it == "system" })
        }
    }

    private fun regeln(name: String): Element {
        val f = File(Quellen.projekt, "app/src/main/res/xml/$name")
        assertTrue("$f fehlt", f.isFile)
        return DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(f).documentElement
    }

    private fun Element.ausgenommen(): Set<String> =
        alle("exclude").map { "${it.getAttribute("domain")}:${it.getAttribute("path")}" }.toSet()

    /** Die dritte Linie: Was zum Konto gehört, wandert weder per Transfer noch per Sicherung mit. */
    @Test
    fun `Kontodaten verlassen das Geraet nicht`() {
        val noetig = setOf("file:datastore", "database:bestand.db", "sharedpref:widget.xml",
            "sharedpref:design_spiegel.xml", "file:vorschau", "file:pdf", "file:update", "external:pdf")
        val r = regeln("data_extraction_rules.xml")
        val listen = mapOf(
            "cloud-backup" to r.alle("cloud-backup").single().ausgenommen(),
            "device-transfer" to r.alle("device-transfer").single().ausgenommen(),
            "backup_rules.xml" to regeln("backup_rules.xml").ausgenommen(),
        )
        for ((wo, liste) in listen) assertTrue("$wo: es fehlt ${noetig - liste}", liste.containsAll(noetig))
        assertEquals("Die drei Listen weichen voneinander ab", 1, listen.values.toSet().size)
    }
}
