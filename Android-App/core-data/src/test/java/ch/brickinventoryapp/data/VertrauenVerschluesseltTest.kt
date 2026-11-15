package ch.brickinventoryapp.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.sicherheit.Vertrauenschiffre
import ch.brickinventoryapp.testing.testVertrauenschiffre
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.IOException
import java.util.Base64

/**
 * Pins (TOFU) und der Schalter „Nutzer-CAs vertrauen“ liegen verschlüsselt im Spiegel
 * der GeraeteAblage; Klartext älterer Fassungen wird einmal übernommen und gelöscht.
 * Was sich nicht entschlüsseln lässt, heisst „kein Pin“ bzw. „Schalter aus“ — der
 * Nutzer bestätigt neu, nie gilt ein unprüfbarer Wert als Vertrauen. Ein Neustart ist
 * eine neue Instanz auf denselben SharedPreferences.
 *
 * Gegenproben (Robolectric, misst die CI; Job `gegenproben`):
 *   vertrauen-pin-klartext           merkePin() schreibt zusätzlich den Klartext → rot
 *                                    „Pin und Schalter liegen nicht im Klartext“
 *   vertrauen-unlesbar-erlaubt       nutzerCaErlaubt() nimmt einen unlesbaren Wert als
 *                                    „an“ → rot „ein veraenderter Wert gilt nicht“
 *   vertrauen-ohne-bindung           Vertrauenschiffre bindet den Namen nicht → rot
 *                                    „ein Geheimtext unter fremdem Namen gilt nicht“
 *   vertrauen-klartext-bleibt        die Übernahme löscht den Klartext nicht → rot
 *                                    „Klartext wird einmal uebernommen“
 *   vertrauen-marke-uebergangen      die Marke wird nicht geprüft → rot „spaeter
 *                                    hingelegter Klartext gilt nicht“
 *   vertrauen-fehler-als-klartext    merkePin() legt bei gescheitertem Verschlüsseln
 *                                    Klartext ab → rot „ohne Schluessel bleibt nichts …“
 *   code-pin-ueber-alte-verbindung   halteVor() ruft die Hörer nicht → rot „ein Pin aus dem
 *                                    Code gilt nur ueber eine neue Verbindung“
 *   pin-namen-ohne-uebernahme        bereiteVor() ohne uebernimmPinNamen() → rot „ein Pin
 *                                    frueherer Fassung kommt unter einen Namen …“
 *   pin-name-mit-host                pinEintrag() hängt wieder Host und Port an → rot „kein
 *                                    Eintrag nennt den Server“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class VertrauenVerschluesseltTest {

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val spiegel: SharedPreferences =
        ctx.getSharedPreferences(GeraeteAblage.DESIGN_SPIEGEL_DATEI, Context.MODE_PRIVATE)
    private val host = "brick.example.org:443"
    private val fp = "sha256/AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKK="

    @Before
    fun leer() = spiegel.edit(commit = true) { clear() }

    /** Wie beim App-Start: neue Instanz, bereiteVor() vor dem ersten Verbindungsaufbau. */
    private fun start(chiffre: Vertrauenschiffre = testVertrauenschiffre()): GeraeteAblage {
        val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "vertrauen-${System.nanoTime()}.preferences_pb") }
        return GeraeteAblage(ctx, store, chiffre).also { it.bereiteVor() }
    }

    private fun klartextAufPlatte(): List<String> =
        spiegel.all.filter { (k, v) -> k == GeraeteAblage.NUTZER_CA || k.startsWith(GeraeteAblage.PIN_PRAEFIX) || v == fp }
            .map { (k, v) -> "$k=$v" }

    @Test
    fun `Pin und Schalter liegen nicht im Klartext und ueberstehen den Neustart`() {
        val g = start()
        g.merkePin(host, fp)
        g.setzeNutzerCa(true)
        assertEquals("Pin und Schalter liegen nicht im Klartext", emptyList<String>(), klartextAufPlatte())
        val neu = start()
        assertEquals(fp, neu.pin(host))
        assertTrue(neu.nutzerCaErlaubt())
        neu.setzeNutzerCa(false)
        assertFalse("Aus bleibt aus", start().nutzerCaErlaubt())
    }

    @Test
    fun `ein veraenderter Wert gilt nicht, auch nicht mit fremdem Schluessel`() {
        start().apply { merkePin(host, fp); setzeNutzerCa(true) }
        assertNull("Fremder Schlüssel: kein Pin", start(testVertrauenschiffre(8)).pin(host))
        assertFalse("Fremder Schlüssel: Schalter aus", start(testVertrauenschiffre(8)).nutzerCaErlaubt())
        val eintrag = start().pinEintrag(host)!!
        spiegel.edit(commit = true) {
            putString(GeraeteAblage.NUTZER_CA_GEHEIM, kippe(spiegel.getString(GeraeteAblage.NUTZER_CA_GEHEIM, null)!!))
            putString(eintrag, "kein-base64-%%%")
        }
        val g = start()
        assertFalse("ein veraenderter Wert gilt nicht als „an“", g.nutzerCaErlaubt())
        assertNull("ein unlesbarer Pin ist kein Pin — der Nutzer bestätigt neu", g.pin(host))
    }

    @Test
    fun `ein Geheimtext unter fremdem Namen gilt nicht`() {
        val anderer = "anderer.example.org:443"
        val g0 = start().apply { merkePin(anderer, fp) }
        val geheim = spiegel.getString(g0.pinEintrag(anderer)!!, null)!!
        spiegel.edit(commit = true) {
            putString(g0.pinEintrag(host)!!, geheim)
            putString(GeraeteAblage.NUTZER_CA_GEHEIM, geheim)
        }
        val g = start()
        assertNull("Der Pin eines anderen Servers gilt nicht für diesen", g.pin(host))
        assertFalse("Ein Pin-Geheimtext schaltet die Nutzer-CAs nicht ein", g.nutzerCaErlaubt())
        assertEquals(fp, g.pin(anderer))
    }

    @Test
    fun `Klartext wird einmal uebernommen und danach geloescht`() {
        spiegel.edit(commit = true) {
            putBoolean(GeraeteAblage.NUTZER_CA_AUS_ANGEWANDT, true)
            putBoolean(GeraeteAblage.NUTZER_CA, true)
            putString(GeraeteAblage.PIN_PRAEFIX + host, fp)
        }
        val g = start()
        assertEquals("Der alte Pin gilt weiter", fp, g.pin(host))
        assertTrue("Der alte Schalter gilt weiter", g.nutzerCaErlaubt())
        assertEquals("Klartext wird einmal uebernommen und danach geloescht", emptyList<String>(), klartextAufPlatte())
        assertEquals(fp, start().pin(host))
    }

    @Test
    fun `spaeter hingelegter Klartext gilt nicht und wird geloescht`() {
        start().merkePin(host, fp)
        spiegel.edit(commit = true) {
            putBoolean(GeraeteAblage.NUTZER_CA, true)
            putString(GeraeteAblage.PIN_PRAEFIX + "boese.example.org:443", fp)
        }
        val g = start()
        assertFalse("spaeter hingelegter Klartext gilt nicht", g.nutzerCaErlaubt())
        assertNull(g.pin("boese.example.org:443"))
        assertEquals(fp, g.pin(host))
        assertEquals(emptyList<String>(), klartextAufPlatte())
    }

    @Test
    fun `ohne Schluessel bleibt nichts im Klartext und nichts gilt als erlaubt`() {
        val kaputt = Vertrauenschiffre { throw IOException("Keystore gerade nicht bereit") }
        spiegel.edit(commit = true) {
            putBoolean(GeraeteAblage.NUTZER_CA_AUS_ANGEWANDT, true)
            putBoolean(GeraeteAblage.NUTZER_CA, true)
        }
        val g = start(kaputt)
        assertFalse("Nicht übernommener Klartext gilt nicht", g.nutzerCaErlaubt())
        g.setzeNutzerCa(true)
        assertFalse("Ein unverschlüsselbares „an“ wird nicht abgelegt", g.nutzerCaErlaubt())
        g.merkePin(host, fp)
        assertEquals("Bestätigt gilt der Pin bis zum Prozessende", fp, g.pin(host))
        assertEquals("ohne Schluessel bleibt nichts im Klartext auf der Platte",
            listOf("${GeraeteAblage.NUTZER_CA}=true"), klartextAufPlatte())
        assertTrue("Mit Schlüssel wird der liegengebliebene Klartext übernommen", start().nutzerCaErlaubt())
        assertNull("Der ungesicherte Pin überlebt den Neustart nicht", start().pin(host))
    }

    @Test
    fun `kein Eintrag nennt den Server`() {
        start().apply { merkePin(host, fp); merkePin("$host#blatt", fp) }
        val namen = spiegel.all.keys
        assertTrue("Pins sind abgelegt: $namen", namen.count { it.startsWith(GeraeteAblage.PIN_NAME_PRAEFIX) } == 2)
        assertFalse("Ein Name verrät den Server: $namen", namen.any { "example" in it || "443" in it })
    }

    @Test
    fun `ein Pin frueherer Fassung kommt unter einen Namen ohne Server und gilt weiter`() {
        val g0 = start()
        g0.merkePin(host, fp)
        val eintrag = g0.pinEintrag(host)!!
        val geheim = spiegel.getString(eintrag, null)!!
        // So lag er in früheren Fassungen: derselbe Geheimtext, Host und Port im Namen.
        spiegel.edit(commit = true) { remove(eintrag); putString(GeraeteAblage.PIN_GEHEIM_PRAEFIX + host, geheim) }
        val g = start()
        assertEquals(fp, g.pin(host))
        assertFalse("Der alte Name ist weg", spiegel.contains(GeraeteAblage.PIN_GEHEIM_PRAEFIX + host))
        assertEquals(geheim, spiegel.getString(eintrag, null))
    }

    /** Ein Bit im Geheimtext umdrehen: Das Base64 bleibt gültig, der GCM-Tag nicht. */
    private fun kippe(b64: String): String {
        val roh = Base64.getDecoder().decode(b64)
        roh[roh.size - 1] = (roh[roh.size - 1].toInt() xor 1).toByte()
        return Base64.getEncoder().encodeToString(roh)
    }

    /**
     * Die Server-Clients bauen auf das Signal ihren TLS-Kontext neu und leeren den
     * Verbindungsvorrat (di/ServerClient); ohne es liefe die Anmeldung über eine schon
     * offene Verbindung, und der Fingerabdruck aus dem Code würde nie geprüft.
     */
    @Test
    fun `ein Pin aus dem Code gilt nur ueber eine neue Verbindung`() {
        val g = start()
        var neu = 0
        g.beimNutzerCaWechsel { neu++ }
        g.halteVor(host, fp)
        assertEquals(1, neu)
        assertTrue(g.ausCode(host))
        assertEquals(fp, g.pin(host))
        g.merkePin(host, fp)
        assertFalse("Gemerkt gilt er nicht mehr als Pin aus dem Code", g.ausCode(host))
    }
}
