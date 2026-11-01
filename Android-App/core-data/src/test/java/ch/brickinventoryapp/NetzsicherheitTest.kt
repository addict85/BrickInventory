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
}
