package ch.brickinventoryapp.data

import ch.brickinventoryapp.network.util.NetworkPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import ch.brickinventoryapp.testing.Quellen

/**
 * The network security config is the second line behind the guard: in the
 * release build it forbids cleartext everywhere, in the debug build it allows it
 * exactly to the hosts the guard lets through as well.
 *
 * Counter-checks:
 *   A  in src/main the base-config back to cleartextTrafficPermitted="true" →
 *      red “the release build allows cleartext nowhere”
 *   B  in src/debug a further host (192.168.1.50) with cleartext → red “the
 *      debug build allows cleartext only …”
 *   C  in src/main a <certificates src="user" /> → red “both versions
 *      trust only system CAs”
 *   G  that the server clients follow no redirect themselves is checked by ServerClientsTest
 *      on the built clients; what the guard does instead, RedirectTest.
 *   H  in src/main the line
 *      <certificateTransparency> of the base-config removed → red “the release build
 *      requires Certificate Transparency”
 *   J  gegenproben/debug-ohne-ct.patch: in
 *      src/debug <certificateTransparency> of the base-config removed → red “the debug build …”
 *   I  in data_extraction_rules.xml under device-transfer `database` removed → red
 *      “account data does not leave the device”; gegenproben/workdb-wird-uebertragen.patch
 *   K  in backup_rules.xml `root` removed → red, the same test
 */
class NetzsicherheitTest {

    private fun lies(variant: String): Element {
        val f = File(Quellen.project, "app/src/$variant/res/xml/network_security_config.xml")
        assertTrue("$f fehlt", f.isFile)
        return DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(f).documentElement
    }

    private fun Element.children(name: String): List<Element> =
        (0 until childNodes.length).map { childNodes.item(it) }.filterIsInstance<Element>().filter { it.tagName == name }

    private fun Element.alle(name: String): List<Element> =
        getElementsByTagName(name).let { l -> (0 until l.length).map { l.item(it) as Element } }

    @Test
    fun `the release build allows cleartext nowhere`() {
        val cfg = lies("main")
        val basis = cfg.children("base-config").single()
        assertEquals("false", basis.getAttribute("cleartextTrafficPermitted"))
        val erlaubt = (cfg.children("domain-config") + basis).filter { it.getAttribute("cleartextTrafficPermitted") != "false" }
        assertTrue("Klartext erlaubt in: " + erlaubt.map { it.tagName }, erlaubt.isEmpty())
        assertTrue("Unterdrückte Lint-Warnung", !cfg.hasAttribute("xmlns:tools"))
    }

    @Test
    fun `the debug build allows cleartext only to the device and the emulator host`() {
        val cfg = lies("debug")
        assertEquals("false", cfg.children("base-config").single().getAttribute("cleartextTrafficPermitted"))
        val klartext = cfg.children("domain-config").filter { it.getAttribute("cleartextTrafficPermitted") == "true" }
        val hosts = klartext.flatMap { it.children("domain") }
        assertEquals(NetworkPolicy.ENTWICKLUNGS_HOSTS, hosts.map { it.textContent.trim() }.toSet())
        assertTrue("Ohne Unterdomänen", hosts.all { it.getAttribute("includeSubdomains") == "false" })
    }

    @Test
    fun `the release build requires Certificate Transparency`() {
        val cfg = lies("main")
        val areas = cfg.children("domain-config") + cfg.children("base-config")
        val ohne = areas.filter { b -> b.children("certificateTransparency").none { it.getAttribute("enabled") == "true" } }
        assertTrue("Ohne Certificate Transparency: " + ohne.map { it.tagName }, areas.isNotEmpty() && ohne.isEmpty())
    }

    /** Like release, except for the development hosts in cleartext; otherwise the debug build would check another chain. */
    @Test
    fun `the debug build requires Certificate Transparency like release`() {
        val cfg = lies("debug")
        val areas = (cfg.children("domain-config") + cfg.children("base-config"))
            .filter { it.getAttribute("cleartextTrafficPermitted") != "true" }
        val ohne = areas.filter { b -> b.children("certificateTransparency").none { it.getAttribute("enabled") == "true" } }
        assertTrue("Ohne Certificate Transparency: " + ohne.map { it.tagName }, areas.size == 2 && ohne.isEmpty())
    }

    @Test
    fun `both versions trust only system CAs`() {
        for (variant in listOf("main", "debug")) {
            val quellen = lies(variant).alle("certificates").map { it.getAttribute("src") }
            assertTrue("$variant: $quellen", quellen.isNotEmpty() && quellen.all { it == "system" })
        }
    }

    private fun rules(name: String): Element {
        val f = File(Quellen.project, "app/src/main/res/xml/$name")
        assertTrue("$f fehlt", f.isFile)
        return DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(f).documentElement
    }

    private fun Element.ausgenommen(): Set<String> =
        alle("exclude").map { "${it.getAttribute("domain")}:${it.getAttribute("path")}" }.toSet()

    /** The third line: what belongs to the account travels neither by transfer nor by backup. */
    @Test
    fun `account data does not leave the device`() {
        // Whole domains: a new store does not travel just because it is missing here.
        val noetig = setOf("root:.", "file:.", "database:.", "external:.", "device_root:.")
        val r = rules("data_extraction_rules.xml")
        val listen = mapOf(
            "cloud-backup" to r.alle("cloud-backup").single().ausgenommen(),
            "device-transfer" to r.alle("device-transfer").single().ausgenommen(),
            "backup_rules.xml" to rules("backup_rules.xml").ausgenommen(),
        )
        for ((wo, liste) in listen) assertTrue("$wo: es fehlt ${noetig - liste}", liste.containsAll(noetig))
        assertEquals("Die drei Listen weichen voneinander ab", 1, listen.values.toSet().size)
    }
}
