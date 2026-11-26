package ch.brickinventoryapp.data

import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

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
 *   J  counter-checks/debug-without-ct.patch: in
 *      src/debug <certificateTransparency> of the base-config removed → red “the debug build …”
 *   I  in data_extraction_rules.xml under device-transfer `database` removed → red
 *      “account data does not leave the device”; counter-checks/workdb-is-transferred.patch
 *   K  in backup_rules.xml `root` removed → red, the same test
 */
class NetworkSecurityTest {

    private fun read(variant: String): Element {
        val f = File(Sources.project, "app/src/$variant/res/xml/network_security_config.xml")
        assertTrue("$f missing", f.isFile)
        return DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(f).documentElement
    }

    private fun Element.children(name: String): List<Element> =
        (0 until childNodes.length).map { childNodes.item(it) }.filterIsInstance<Element>().filter { it.tagName == name }

    private fun Element.all(name: String): List<Element> =
        getElementsByTagName(name).let { l -> (0 until l.length).map { l.item(it) as Element } }

    @Test
    fun `the release build allows cleartext nowhere`() {
        val cfg = read("main")
        val basis = cfg.children("base-config").single()
        assertEquals("false", basis.getAttribute("cleartextTrafficPermitted"))
        val allowed = (cfg.children("domain-config") + basis).filter { it.getAttribute("cleartextTrafficPermitted") != "false" }
        assertTrue("Plaintext allowed in: " + allowed.map { it.tagName }, allowed.isEmpty())
        assertTrue("Suppressed lint warning", !cfg.hasAttribute("xmlns:tools"))
    }

    @Test
    fun `the debug build allows cleartext only to the device and the emulator host`() {
        val cfg = read("debug")
        assertEquals("false", cfg.children("base-config").single().getAttribute("cleartextTrafficPermitted"))
        val plaintext = cfg.children("domain-config").filter { it.getAttribute("cleartextTrafficPermitted") == "true" }
        val hosts = plaintext.flatMap { it.children("domain") }
        assertEquals(NetworkPolicy.DEVELOPMENT_HOSTS, hosts.map { it.textContent.trim() }.toSet())
        assertTrue("Without subdomains", hosts.all { it.getAttribute("includeSubdomains") == "false" })
    }

    @Test
    fun `the release build requires Certificate Transparency`() {
        val cfg = read("main")
        val areas = cfg.children("domain-config") + cfg.children("base-config")
        val without = areas.filter { b -> b.children("certificateTransparency").none { it.getAttribute("enabled") == "true" } }
        assertTrue("Without Certificate Transparency: " + without.map { it.tagName }, areas.isNotEmpty() && without.isEmpty())
    }

    /** Like release, except for the development hosts in cleartext; otherwise the debug build would check another chain. */
    @Test
    fun `the debug build requires Certificate Transparency like release`() {
        val cfg = read("debug")
        val areas = (cfg.children("domain-config") + cfg.children("base-config"))
            .filter { it.getAttribute("cleartextTrafficPermitted") != "true" }
        val without = areas.filter { b -> b.children("certificateTransparency").none { it.getAttribute("enabled") == "true" } }
        assertTrue("Without Certificate Transparency: " + without.map { it.tagName }, areas.size == 1 && without.isEmpty())
    }

    @Test
    fun `both versions trust only system CAs`() {
        for (variant in listOf("main", "debug")) {
            val sources = read(variant).all("certificates").map { it.getAttribute("src") }
            assertTrue("$variant: $sources", sources.isNotEmpty() && sources.all { it == "system" })
        }
    }

    private fun rules(name: String): Element {
        val f = File(Sources.project, "app/src/main/res/xml/$name")
        assertTrue("$f missing", f.isFile)
        return DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(f).documentElement
    }

    private fun Element.excepted(): Set<String> =
        all("exclude").map { "${it.getAttribute("domain")}:${it.getAttribute("path")}" }.toSet()

    /** The third line: what belongs to the account travels neither by transfer nor by backup. */
    @Test
    fun `account data does not leave the device`() {
        // Whole domains: a new store does not travel just because it is missing here.
        val needed = setOf("root:.", "file:.", "database:.", "external:.", "device_root:.")
        val r = rules("data_extraction_rules.xml")
        val lists = mapOf(
            "cloud-backup" to r.all("cloud-backup").single().excepted(),
            "device-transfer" to r.all("device-transfer").single().excepted(),
            "backup_rules.xml" to rules("backup_rules.xml").excepted(),
        )
        for ((where, list) in lists) assertTrue("$where: missing ${needed - list}", list.containsAll(needed))
        assertEquals("The three lists differ from each other", 1, lists.values.toSet().size)
    }
}
