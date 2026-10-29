package ch.brickinventoryapp

import ch.brickinventoryapp.util.fmtAmount
import ch.brickinventoryapp.util.fmtEingabe
import ch.brickinventoryapp.util.fmtInt
import ch.brickinventoryapp.util.fmtMoney
import ch.brickinventoryapp.util.fmtMoneyOrDash
import ch.brickinventoryapp.util.zahlenLocale
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Zahlen und Beträge kommen aus EINER Fassung — und die folgt der App-Sprache.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 * Für denselben Betrag gab es drei Schreibweisen: Die Webapp formatierte über
 * `Intl.NumberFormat(locale(), {style:'currency'})`, der Finanzreiter der App
 * setzte das Symbol VOR den Betrag, alle übrigen Bildschirme den Währungscode
 * DAHINTER. Dazu nagelte `fmtSwissAmount()` de-CH fest, während die Webapp der
 * eingestellten Sprache folgt — ein englischsprachiger App-Nutzer sah
 * `1'234.50`, im Browser `1,234.50`.
 *
 * Der Test prüft zwei Dinge getrennt:
 *   • die REGEL (Teil 1): keine Ansicht baut sich ihren Betrag mehr selbst
 *     zusammen. Das ist die Aussage, die beim nächsten neuen Bildschirm zählt.
 *   • das ERGEBNIS (Teil 2): die Helfer liefern tatsächlich etwas Brauchbares.
 *     Eine reine Quelltextregel hätte hier nicht gereicht — genau diese Lücke
 *     war die Lehre aus Nachtrag 48 (der Test prüfte die Regel, es entstand
 *     trotzdem nie eine Datei).
 *
 * Bewusst NICHT festgenagelt: wo de-CH das Währungssymbol setzt — das
 * entscheidet die Plattform. Festgenagelt sind dagegen Tausender- und
 * Dezimalzeichen je Landesform (Teil 3), denn die wählt unser Code.
 *
 * Gegenproben Teil 3 (29.10.2026, gemessen gegen util/NumberFormatUtils.kt):
 *   A  zahlenLocale() wieder fest de-CH/en-GB → rot „de-DE schreibt Punkt und
 *      Komma …“ und „ohne passende Landesform …“ (de-AT)
 *   B  das Land ohne Sprachprüfung übernommen → rot „ohne passende Landesform …“
 *      (de mit Gerät en-US ergab de-US)
 *   C  in fmtEingabe() isGroupingUsed nicht abgeschaltet → rot „ein Eingabefeld
 *      bekommt den Betrag ohne Tausendertrennung zurück“
 *   D  in AcquisitionManagementScreen.kt wieder "%.2f".format → rot „keine
 *      Ansicht setzt Betrag und Währung selbst zusammen“
 */
class NumberFormatTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()

    /** Kommentare zeilenweise ausblenden — sonst hält der eigene Erklärtext die Prüfung grün. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    // ── Teil 1: die Regel ────────────────────────────────────────────────────

    @Test
    fun `keine Ansicht setzt Betrag und Waehrung selbst zusammen`() {
        val schirme = listOf(
            "AppNavigation.kt",
            "ui/screens/PartsScreen.kt",
            "ui/screens/FinanceScreen.kt",
            "ui/screens/SetDetailScreen.kt",
            "ui/screens/SetDetailComponents.kt",
            "ui/screens/ManualItemComposables.kt",
            "ui/screens/ManualItemDetailScreen.kt",
            "ui/screens/AcquisitionManagementScreen.kt",
            "ui/screens/GalleryScreen.kt",
            "ui/screens/EinstellungenAlarme.kt",
        )
        for (f in schirme) {
            val c = code(read(f))
            assert(!c.contains("fmtSwissAmount") && !c.contains("fmtSwissInt")) {
                "$f benutzt noch die alte, fest auf de-CH genagelte Fassung"
            }
            assert(!c.contains("Currency.getInstance")) {
                "$f baut sich das Währungssymbol selbst — das gehört in fmtMoney(), " +
                    "sonst steht es hier vor und anderswo hinter dem Betrag"
            }
            // Das Dollarzeichen steht als ${'$'} und nicht als Backslash-$.
            // In einem Rohstring (dreifache Anfuehrungszeichen) wirken KEINE
            // Backslash-Escapes, die String-Vorlage aber schon. Die alte
            // Schreibweise war deshalb kein Zeichen, sondern ein Zugriff auf eine
            // Variable namens currency — die es nicht gibt. Genau daran scheiterte
            // der Testbau ("Unresolved reference 'currency'"), und zwar seit dem
            // ersten Commit: ohne Gradle-Wrapper lief hier nie ein Testlauf.
            assert(!Regex("""\{[^}]*fmt[A-Za-z]*\([^)]*\)[^}]*\}\s*\${'$'}currency""").containsMatchIn(c)) {
                "$f hängt den Währungscode von Hand an einen formatierten Betrag"
            }
            assert(!c.contains("\"%,d\".format")) {
                "$f formatiert eine Zahl von Hand statt über fmtInt()"
            }
            assert(!c.contains("\"%.2f\".format")) {
                "$f formatiert einen Betrag in der Gerätesprache statt über fmtAmount()/fmtEingabe()"
            }
        }
    }

    @Test
    fun `die Gegenrichtung bleibt Sache der Plattform`() {
        // getCurrencyInstance macht die Stellung von Symbol und Betrag zur Sache
        // der Locale; von Hand zusammengesetzt kämen die drei Schreibweisen zurück.
        assert(code(read("util/NumberFormatUtils.kt")).contains("getCurrencyInstance")) {
            "fmtMoney muss die Währungs-Formatierung der Plattform benutzen"
        }
    }

    // ── Teil 2: das Ergebnis ─────────────────────────────────────────────────

    @Test
    fun `Betraege enthalten Zahl und Waehrung`() {
        val s = fmtMoney(1234.5, "CHF")
        assert(s.contains("1") && s.contains("234")) { "Der Betrag fehlt: $s" }
        assert(s.contains("CHF") || s.contains("Fr")) { "Die Währung fehlt: $s" }
        // Zwei Nachkommastellen, wie in der Webapp (minimumFractionDigits: 2).
        assert(Regex("""[.,]\d{2}(\D|$)""").containsMatchIn(s)) {
            "Es fehlen die zwei Nachkommastellen: $s"
        }
    }

    @Test
    fun `ein unbekannter Waehrungscode sprengt die Anzeige nicht`() {
        // Kommt vor, wenn der Server einen Code liefert, den die Plattform
        // nicht kennt. Vorher fiel das in ein catch, das eine ZWEITE
        // Schreibweise erzeugte — jetzt ist der Rückfall Teil derselben Fassung.
        val s = fmtMoney(10.0, "XYZ123")
        assert(s.contains("10")) { "Der Betrag muss auch ohne bekannte Währung erscheinen: $s" }
    }

    @Test
    fun `fehlender Betrag ergibt einen Gedankenstrich`() {
        assertEquals("—", fmtMoneyOrDash(null, "CHF"))
        assertEquals("—", fmtMoneyOrDash("keine Zahl", "CHF"))
        assert(fmtMoneyOrDash("12.5", "CHF").contains("12")) { "gültiger Wert muss durchkommen" }
    }

    @Test
    fun `Zahlen ohne Waehrung tragen eine Tausendertrennung`() {
        val i = fmtInt(60000)
        assert(i.length > 5) { "60000 sollte getrennt werden, war: $i" }
        assert(i.contains("60")) { "unerwartete Ausgabe: $i" }
        val a = fmtAmount(1234.5)
        assert(Regex("""[.,]\d{2}$""").containsMatchIn(a)) { "zwei Nachkommastellen erwartet: $a" }
    }

    // ── Teil 3: die Landesform folgt dem Gerät, wie im Web ──────────────────

    private fun mitGeraet(tag: String, block: () -> Unit) {
        val vorher = java.util.Locale.getDefault()
        java.util.Locale.setDefault(java.util.Locale.forLanguageTag(tag))
        try { block() } finally { java.util.Locale.setDefault(vorher) }
    }

    @Test
    fun `de-DE schreibt Punkt und Komma, de-CH Hochkomma und Punkt`() {
        mitGeraet("de-DE") { assertEquals("4.894,77", fmtAmount(4894.77)) }
        mitGeraet("de-CH") { assertEquals("4\u2019894.77", fmtAmount(4894.77)) }
        mitGeraet("en-US") { assertEquals("4,894.77", fmtAmount(4894.77)) }
    }

    @Test
    fun `ein Eingabefeld bekommt den Betrag ohne Tausendertrennung zurueck`() {
        mitGeraet("de-DE") { assertEquals("4894,77", fmtEingabe(4894.77)) }
        mitGeraet("de-CH") { assertEquals("4894.77", fmtEingabe(4894.77)) }
        // So liest AcquisitionManagementRow das Feld beim Speichern.
        mitGeraet("de-DE") { assertEquals(4894.77, fmtEingabe(4894.77).replace(',', '.').toDouble(), 0.0) }
    }

    @Test
    fun `ohne passende Landesform gelten de-CH und en-GB`() {
        val de = java.util.Locale.forLanguageTag("de")
        assertEquals("de-CH", zahlenLocale(de, java.util.Locale.forLanguageTag("en-US")).toLanguageTag())
        assertEquals("de-CH", zahlenLocale(de, de).toLanguageTag())
        assertEquals("en-GB", zahlenLocale(java.util.Locale.forLanguageTag("fr-FR"), java.util.Locale.forLanguageTag("fr-FR")).toLanguageTag())
        assertEquals("Das Land kommt vom Gerät, die Sprache von der App",
            "de-AT", zahlenLocale(de, java.util.Locale.forLanguageTag("de-AT")).toLanguageTag())
        assertEquals("en-GB", zahlenLocale(java.util.Locale.forLanguageTag("en"), java.util.Locale.forLanguageTag("de-DE")).toLanguageTag())
    }
}
