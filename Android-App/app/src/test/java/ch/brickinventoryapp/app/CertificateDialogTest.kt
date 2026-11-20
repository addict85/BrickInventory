package ch.brickinventoryapp.app

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.app.ui.components.CertificateDialog
import ch.brickinventoryapp.app.ui.components.closable
import ch.brickinventoryapp.security.Transcript
import org.junit.Assert.assertFalse
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.fingerprintReadable
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.Base64

/**
 * Was der Zertifikatsdialog zeigt: Wo abgetippt wird, steht der abzutippende Teil
 * nicht auf dem Bildschirm (nur der Anfang); beim Erstkontakt über eine öffentliche
 * CA der ganze Fingerabdruck zum Vergleichen.
 *
 * Gegenproben (Robolectric, nur in der CI messbar; Job `gegenproben`):
 *   (a) im Dialog wieder `fingerprintReadable(frage.fingerabdruck)` statt des
 *       Anfangs → rot „wer abtippt, sieht den abzutippenden Teil nicht“
 *       (gegenproben/zertifikat-zeigt-alles.patch)
 *   (b) `writeOff` nur für GEAENDERT → rot „ueber eine Nutzer-CA …“
 *       (gegenproben/nutzerca-ein-tipp.patch)
 *   (c) CertificateDialog ohne den Zweig für CODE_ABWEICHUNG → rot „weicht der
 *       Server vom Code ab …“ (gegenproben/code-abweichung-im-dialog.patch)
 *   (d) das Feld wieder mit dem ganzen Satz als Etikett, ohne Erklärung darunter →
 *       rot „das Feld traegt ein kurzes Etikett …“ (gegenproben/zertifikat-satz-als-etikett.patch)
 *   (e) Fingerabdruckfeld ohne pairTranscriptIn() (keine Doppelpunkte) → rot „die Abschrift
 *       bekommt beim Tippen Doppelpunkte …“ (gegenproben/abschrift-ohne-paare.patch)
 *   (f) in transcriptError() TO_SHORT wie FITS_NOT → rot „zu kurz und falsch …“
 *       (gegenproben/abschrift-zu-kurz-wie-falsch.patch)
 *   (g) schliessbar() mit `dismissOnClickOutside = true` → rot „daneben tippen schliesst
 *       den Dialog nie …“ (gegenproben/zertifikat-daneben-verworfen.patch)
 *   (h) `writeOff` auch für SCHLUESSEL_NEU → rot „ein neuer Serverschluessel steht
 *       ganz da …“ (gegenproben/schluessel-neu-abtippen.patch)
 *   (i) der Knopf „stattdessen abtippen“ entfernt → rot „beim Erstkontakt laesst sich
 *       stattdessen abtippen …“ (gegenproben/erstkontakt-ohne-abtippen.patch)
 *   (j) `writeOff` für SCHLUESSEL_NEU wieder immer aus → rot „ohne CT-Pflicht wird ein
 *       neuer Serverschluessel abgetippt …“ (gegenproben/schluessel-neu-dialog-ohne-feld.patch)
 *   (k) `writeOff` beim Erstkontakt wieder nur auf Wunsch → rot „ohne CT-Pflicht wird beim
 *       Erstkontakt abgetippt …“ (gegenproben/erstkontakt-dialog-ein-tipp.patch)
 */
@RunWith(RobolectricTestRunner::class)
class CertificateDialogTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity
    private val fp = Base64.getEncoder().encodeToString(ByteArray(32) { (it * 7 + 3).toByte() })
    private val hex = fingerprintReadable(fp)

    private fun zeige(
        art: CertificateUnresolved.Art,
        erwartet: String? = null,
        ct: Boolean = false,
        trustOn: (String?) -> Boolean = { false },
    ) {
        val frage = CertificateUnresolved("nas:8443", fp, art, erwartet, ctForced = ct)
        compose.setContent {
            BrickInventoryManagerTheme {
                CertificateDialog(frage, userCaAn = false, trustOn = trustOn, onNutzerCa = {}, onAbbrechen = {})
            }
        }
        compose.waitForIdle()
    }

    private fun feld() = compose.onNode(hasSetTextAction())

    private fun getippt(): String =
        feld().fetchSemanticsNode().config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty()

    /**
     * Die Webapp zeigt `AB:CD:…`. Wer „24 Zeichen“ samt Doppelpunkten abschrieb, hatte nur 16
     * Hex. Das Feld setzt die Doppelpunkte selbst und zählt nur, was zählt.
     */
    @Test
    fun `die Abschrift bekommt beim Tippen Doppelpunkte und einen Zaehler der Zeichen`() {
        zeige(CertificateUnresolved.Art.UNBEKANNTE_CA)
        assertEquals("Der Zähler steht vor dem Tippen da", 1, gezeigt("0/24"))
        feld().performTextInput("3fa2b")
        assertEquals("3F:A2:B", getippt())
        assertEquals(1, gezeigt("5/24"))
        feld().performTextInput("c")
        assertEquals("Weitergetippt wird am Ende, nicht vor dem letzten Zeichen", "3F:A2:BC", getippt())
        assertEquals(1, gezeigt("6/24"))
    }

    @Test
    fun `zu kurz und falsch abgeschrieben sind verschiedene Fehler`() {
        val withoutPoints = hex.replace(":", "")
        zeige(CertificateUnresolved.Art.UNBEKANNTE_CA) { Transcript.confirmed(it, fp) }
        val button = compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen))
        feld().performTextInput(withoutPoints.takeLast(16))
        button.performClick()
        assertEquals("16 Zeichen sind zu kurz, nicht falsch", 1,
            gezeigt(ctx.getString(R.string.zert_eingabe_zu_kurz, 16, 24)))
        assertEquals(0, gezeigt(ctx.getString(R.string.zert_eingabe_falsch)))

        feld().performTextClearance()
        feld().performTextInput("0".repeat(24))
        button.performClick()
        assertEquals(1, gezeigt(ctx.getString(R.string.zert_eingabe_falsch)))

        feld().performTextClearance()
        feld().performTextInput(withoutPoints.takeLast(24))
        button.performClick()
        assertEquals("Angenommen: kein Fehler mehr", 0, gezeigt(ctx.getString(R.string.zert_eingabe_falsch)))
        assertEquals(0, gezeigt(ctx.getString(R.string.zert_eingabe_zu_kurz, 24, 24)))
    }

    /** Ein Tipp daneben verwarf das halb Abgetippte; Zurück gilt nur, solange nichts getippt ist. */
    @Test
    fun `daneben tippen schliesst den Dialog nie, zurueck nur ohne Eingabe`() {
        assertFalse(closable("").dismissOnClickOutside)
        assertTrue(closable("").dismissOnBackPress)
        assertFalse(closable("3F:A2").dismissOnClickOutside)
        assertFalse(closable("3F:A2").dismissOnBackPress)
    }

    private fun gezeigt(text: String) = compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().size

    @Test
    fun `wer abtippt, sieht den abzutippenden Teil nicht`() {
        zeige(CertificateUnresolved.Art.GEAENDERT, erwartet = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        assertEquals("Die letzten 24 Zeichen stehen da", 0, gezeigt(hex.takeLast(35)))
        assertEquals("Der Anfang fehlt", 1, gezeigt(hex.take(11)))
    }

    @Test
    fun `ohne bekannte CA steht nur der Anfang da`() {
        zeige(CertificateUnresolved.Art.UNBEKANNTE_CA)
        assertEquals(0, gezeigt(hex.takeLast(35)))
        assertEquals(1, gezeigt(hex.take(11)))
    }

    @Test
    fun `beim Erstkontakt ueber eine oeffentliche CA steht der ganze Fingerabdruck da`() {
        zeige(CertificateUnresolved.Art.ERSTKONTAKT, ct = true)
        assertEquals(1, gezeigt(hex))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled()
    }

    @Test
    fun `weicht der Server vom Code ab, gibt es nichts zu bestaetigen`() {
        val laut = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        zeige(CertificateUnresolved.Art.CODE_ABWEICHUNG, erwartet = laut)
        compose.onNodeWithText(ctx.getString(R.string.zert_titel_code_abweichung)).assertExists()
        assertEquals("Der Wert des Servers steht ganz da", 1, gezeigt(hex))
        assertEquals("Der Wert des Codes steht ganz da", 1, gezeigt(fingerprintReadable(laut)))
        assertEquals("Kein Knopf zum Vertrauen", 0, gezeigt(ctx.getString(R.string.zert_vertrauen)))
        assertEquals("Kein Feld zum Abtippen", 0,
            compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
    }

    @Test
    fun `das Feld traegt ein kurzes Etikett, die Anleitung steht darunter`() {
        zeige(CertificateUnresolved.Art.GEAENDERT, erwartet = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        val feld = compose.onNode(hasSetTextAction()).fetchSemanticsNode()
        val texts = feld.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        assertTrue("Kein kurzes Etikett: $texts", ctx.getString(R.string.zert_eingabe_etikett) in texts)
        assertTrue("Die Anleitung fehlt: $texts", ctx.getString(R.string.zert_geaendert_eingabe) in texts)
    }

    @Test
    fun `ueber eine Nutzer-CA genuegt kein Tipp, die Eingabe ist blind`() {
        zeige(CertificateUnresolved.Art.NUTZER_CA)
        assertEquals(0, gezeigt(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsNotEnabled()
        compose.onNode(hasSetTextAction()).performTextInput(hex.takeLast(35))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled()
    }

    @Test
    fun `mit CT-Pflicht steht ein neuer Serverschluessel ganz da und gilt ohne Abtippen`() {
        val bisher = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        var angenommen: String? = "nie"
        zeige(CertificateUnresolved.Art.SCHLUESSEL_NEU, erwartet = bisher, ct = true) { angenommen = it; true }
        compose.onNodeWithText(ctx.getString(R.string.zert_titel_schluessel_neu)).assertExists()
        assertEquals("Der neue Schlüssel steht ganz da", 1, gezeigt(hex))
        assertEquals("Der bisherige auch", 1, gezeigt(fingerprintReadable(bisher)))
        assertEquals("Kein Feld zum Abtippen", 0, compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen_neu)).assertIsEnabled().performClick()
        assertEquals(null, angenommen)
    }

    @Test
    fun `ohne CT-Pflicht wird ein neuer Serverschluessel abgetippt, nur der Anfang steht da`() {
        var angenommen: String? = null
        zeige(CertificateUnresolved.Art.SCHLUESSEL_NEU, erwartet = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") { angenommen = it; true }
        assertEquals("Das Abzutippende steht nicht da", 0, gezeigt(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.zert_schluessel_neu_eingabe)).assertExists()
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen_neu)).assertIsNotEnabled()
        feld().performTextInput(hex.replace(":", "").takeLast(24))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen_neu)).assertIsEnabled().performClick()
        assertEquals(hex.replace(":", "").takeLast(24), angenommen?.replace(":", ""))
    }

    @Test
    fun `beim Erstkontakt laesst sich stattdessen abtippen, dann steht nur der Anfang da`() {
        var angenommen: String? = null
        zeige(CertificateUnresolved.Art.ERSTKONTAKT, ct = true) { angenommen = it; true }
        compose.onNodeWithText(ctx.getString(R.string.zert_erstkontakt_abtippen)).performClick()
        compose.waitForIdle()
        assertEquals("Das Abzutippende steht nicht mehr da", 0, gezeigt(hex.takeLast(35)))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsNotEnabled()
        feld().performTextInput(hex.replace(":", "").takeLast(24))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled().performClick()
        assertEquals(hex.replace(":", "").takeLast(24), angenommen?.replace(":", ""))
    }

    /** Android 11–15: Ohne CT ginge eine fehlausgestellte Kette mit einem Tipp durch. */
    @Test
    fun `ohne CT-Pflicht wird beim Erstkontakt abgetippt, ein Tipp genuegt nicht`() {
        var angenommen: String? = null
        zeige(CertificateUnresolved.Art.ERSTKONTAKT) { angenommen = it; true }
        compose.onNodeWithText(ctx.getString(R.string.zert_text_erstkontakt_abtippen, "nas")).assertExists()
        assertEquals("Das Abzutippende steht nicht da", 0, gezeigt(hex.takeLast(35)))
        assertEquals("Abtippen ist keine Wahl", 0, gezeigt(ctx.getString(R.string.zert_erstkontakt_abtippen)))
        compose.onNodeWithText(ctx.getString(R.string.zert_erstkontakt_eingabe)).assertExists()
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsNotEnabled()
        feld().performTextInput(hex.replace(":", "").takeLast(24))
        compose.onNodeWithText(ctx.getString(R.string.zert_vertrauen)).assertIsEnabled().performClick()
        assertEquals(hex.replace(":", "").takeLast(24), angenommen?.replace(":", ""))
    }
}
