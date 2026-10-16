package ch.brickinventoryapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * „Abmelden" steht in der Verwalten-Liste — und NUR dort.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * 17.10.: „Kannst du abmelden ebenfalls in das neue Menu integrieren? Kannst
 * du dies analog in der Android-App so umsetzen?"
 *
 * In der Webapp ist „das neue Menu" die Klappe hinter dem Benutzernamen. Ein
 * solches Kopfmenue gibt es in der App NICHT — ihr Gegenstueck ist die
 * Verwalten-Liste auf dem Einstellungsbildschirm. Dieselbe Form wie dort: die
 * Punkte, ein Trenner, dann die Handlung.
 *
 * ── Warum BEIDE Richtungen geprueft werden ──────────────────────────────────
 *
 * Nur „steht in der Liste" waere gruen geblieben, haette ich den Knopf
 * verdoppelt statt verschoben. Zwei Abmeldeknoepfe sieht man im Quelltext
 * nicht, wohl aber auf dem Bildschirm — und hier gibt es keinen Emulator, in
 * dem das auffiele. Genau dieselbe Zusicherung steht in der Webapp
 * (Web-App/test/menue-sichten.test.js, „Abmelden steht in der Klappe und
 * nicht mehr in der Kopfleiste").
 *
 * ── Gegenproben (durchgefuehrt, Ergebnisse abgeschrieben) ───────────────────
 *
 * Kotlin laesst sich in der Arbeitsumgebung nicht uebersetzen (dl.google.com
 * antwortet mit 403). Gemessen wurde deshalb an einem Nachbau derselben
 * Logik in Python, gegen DIESE Dateien. Der Compiler ist die CI — was hier
 * steht, ist die Logik, nicht die Syntax.
 *
 *   A  den alten OutlinedButton wieder eingefuegt
 *      -> `kein eigener Abmeldeknopf mehr` rot, BEIDE Zusicherungen
 *   B  `pfeil = false` entfernt
 *      -> `die Abmeldezeile verspricht kein Weiter` rot
 *   C  den Trenner entfernt
 *      -> `die Abmeldezeile ist abgesetzt` rot
 *
 * Jede trifft genau ihren Fall. Und ein Fund aus dem ersten Durchgang, der
 * den Aufwand gerechtfertigt hat: In `kein eigener Abmeldeknopf mehr` stand
 * zuerst ein Suchausdruck auf `OutlinedButton(…) { … Logout`. Gegenprobe A
 * machte den Fall zwar rot — aber nur ueber die ZAEHLUNG daneben; der
 * Suchausdruck selbst traf nie, weil zwischen `)` und `{` ein Leerzeichen
 * steht. Ohne die Gegenprobe waere er als stille Attrappe stehen geblieben.
 */
class AbmeldenInDerListeTest {

    // Ueber Quellen.lies() und nicht ueber einen selbst gebauten Pfad: Genau
    // dafuer gibt es den Helfer (29 handgebaute Pfade waren der Grund).
    private val quelle: String by lazy {
        Quellen.ohneKommentare(Quellen.lies("ui/screens/SettingsScreen.kt"))
    }

    /** Der Rumpf der Verwalten-Karte: von ihrem Titel bis zur naechsten Karte. */
    private val verwaltenKarte: String by lazy {
        val auf = quelle.indexOf("R.string.settings_group_manage")
        assertTrue("Die Verwalten-Karte ist nicht mehr zu finden.", auf > 0)
        val zu = quelle.indexOf("R.string.settings_group_display", auf)
        assertTrue("Die naechste Karte ist nicht mehr zu finden.", zu > auf)
        quelle.substring(auf, zu)
    }

    @Test
    fun `Abmelden steht in der Verwalten-Liste`() {
        assertTrue(
            "R.string.settings_logout steht nicht in der Verwalten-Karte — " +
                "dann ist Abmelden nicht in die Liste gezogen.",
            verwaltenKarte.contains("R.string.settings_logout"),
        )
        assertTrue(
            "Die Abmeldezeile ist keine BereichsZeile — dann sieht sie anders " +
                "aus als die Punkte darueber, ohne dass es jemand entschieden hat.",
            Regex("""BereichsZeile\([^)]*R\.string\.settings_logout""", RegexOption.DOT_MATCHES_ALL)
                .containsMatchIn(verwaltenKarte),
        )
    }

    @Test
    fun `kein eigener Abmeldeknopf mehr`() {
        // GENAU EINMAL im ganzen Bildschirm: in der Liste. Ein zweites
        // Vorkommen hiesse, der alte Knopf steht noch irgendwo darunter.
        val treffer = Regex("""R\.string\.settings_logout""").findAll(quelle).count()
        assertEquals(
            "R.string.settings_logout kommt $treffer-mal vor statt einmal — " +
                "steht der alte Knopf am Fuss noch da?",
            1, treffer,
        )
        // Und das Symbol ebenfalls genau einmal. Das faengt den Fall, dass
        // jemand einen zweiten Abmeldeknopf mit EIGENEM Text baut — dann
        // stimmte die Zaehlung oben noch.
        //
        // Hier stand zuerst ein Suchausdruck auf `OutlinedButton(…) { … Logout`.
        // Die Gegenprobe hat ihn als Attrappe entlarvt: Er traf den alten Knopf
        // NICHT, weil zwischen `)` und `{` ein Leerzeichen steht. Rot wurde der
        // Fall nur ueber die Zaehlung darueber. Ein Suchausdruck, der nie
        // zutrifft, sieht aus wie eine Zusicherung und ist keine.
        val symbol = Regex("""Icons\.AutoMirrored\.Filled\.Logout""").findAll(quelle).count()
        assertEquals(
            "Das Logout-Symbol kommt $symbol-mal vor statt einmal — " +
                "steht irgendwo noch ein zweiter Abmeldeknopf?",
            1, symbol,
        )
    }

    @Test
    fun `die Abmeldezeile verspricht kein Weiter`() {
        // Der Pfeil nach rechts sagt „hier geht es weiter". Bei Abmelden
        // stimmt das nicht: Dort passiert etwas, es geht nicht weiter.
        val zeile = verwaltenKarte.substring(verwaltenKarte.indexOf("R.string.settings_logout"))
        assertTrue(
            "Die Abmeldezeile traegt kein `pfeil = false` — sie verspricht dann " +
                "eine Unterseite, die es nicht gibt.",
            zeile.contains("pfeil = false"),
        )
        assertTrue(
            "Die Abmeldezeile traegt keine eigene Farbe — sie sieht dann aus wie " +
                "die Sichtwechsel darueber, obwohl sie die Sitzung beendet.",
            zeile.contains("tonung = MaterialTheme.colorScheme.error"),
        )
    }

    @Test
    fun `die Abmeldezeile ist abgesetzt`() {
        val vorAbmelden = verwaltenKarte.substringBefore("R.string.settings_logout")
        assertTrue(
            "Zwischen den Unterseiten und „Abmelden" steht kein Trenner — dann " +
                "ist die Handlung die siebte gleich aussehende Zeile, und wer " +
                "danebentippt, ist abgemeldet.",
            vorAbmelden.contains("HorizontalDivider"),
        )
    }

    @Test
    fun `die Erklaerzeile gibt es in beiden Sprachen`() {
        // StringResourceParityTest prueft die Mengen; hier geht es um DIESEN
        // Schluessel, damit die Zeile nicht in einer Sprache leer bleibt.
        for (ordner in listOf("values", "values-de")) {
            val xml = java.io.File("src/main/res/$ordner/strings.xml").readText()
            assertTrue(
                "settings_row_logout fehlt in $ordner/strings.xml",
                xml.contains("""name="settings_row_logout""""),
            )
        }
    }
}
