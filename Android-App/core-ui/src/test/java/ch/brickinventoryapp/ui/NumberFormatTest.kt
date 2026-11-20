package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.ui.util.fmtAmount
import ch.brickinventoryapp.ui.util.fmtEingabe
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtMoneyOrDash
import ch.brickinventoryapp.model.util.numbersLocale
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.util.Locale
import ch.brickinventoryapp.testing.Quellen

/**
 * Zahlen und Beträge kommen aus EINER Fassung — und die folgt der App-Sprache.
 *
 * Gegenproben Teil 3 :
 *   A  numbersLocale() wieder fest de-CH/en-GB → rot „de-DE schreibt Punkt und
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
        File(Quellen.root, "$rel").readText()

    /** Kommentare zeilenweise ausblenden — sonst hält der eigene Erklärtext die Prüfung grün. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    // ── Teil 1: die Regel ────────────────────────────────────────────────────

    @Test
    fun `keine Ansicht setzt Betrag und Waehrung selbst zusammen`() {
        val screens = listOf(
            "app/AppNavigation.kt",
            "parts/ui/screens/PartsScreen.kt",
            "parts/ui/screens/TeileFilterBlatt.kt",
            "parts/ui/screens/TeileKarte.kt",
            "finances/ui/screens/FinanceScreen.kt",
            "collection/ui/screens/SetDetailScreen.kt",
            "shared/ui/SetDetailComponents.kt",
            "shared/ui/ManualItemComposables.kt",
            "parts/ui/screens/ManualItemDetailScreen.kt",
            "collection/ui/screens/AcquisitionManagementScreen.kt",
            "collection/ui/screens/GalleryScreen.kt",
            "collection/ui/screens/GalerieFilter.kt",
            "collection/ui/screens/GalerieKarte.kt",
            "collection/ui/screens/GalerieErfassen.kt",
            "account/ui/screens/EinstellungenAlarme.kt",
        )
        for (f in screens) {
            val c = code(read(f))
            assert(!c.contains("fmtSwissAmount") && !c.contains("fmtSwissInt")) {
                "$f benutzt noch die alte, fest auf de-CH genagelte Fassung"
            }
            assert(!c.contains("Currency.getInstance")) {
                "$f baut sich das Währungssymbol selbst — das gehört in fmtMoney(), " +
                    "sonst steht es hier vor und anderswo hinter dem Betrag"
            }
            // Das Dollarzeichen steht als ${'$'} und nicht als Backslash-$.
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

    /**
     * Die Stellung von Symbol und Betrag ist Sache der Landesform (getCurrencyInstance);
     * von Hand zusammengesetzt stünde das Symbol überall auf derselben Seite.
     * Gegenprobe betrag-symbol-von-hand (Symbol vor fmtAmount(); kotlinc) → rot hier.
     */
    @Test
    fun `die Gegenrichtung bleibt Sache der Plattform`() {
        withDevice("de-DE") { assertEquals("812,50\u00A0€", fmtMoney(812.5, Waehrung("EUR"))) }
        withDevice("en-GB") { assertEquals("€812.50", fmtMoney(812.5, Waehrung("EUR"))) }
    }

    // ── Teil 2: das Ergebnis ─────────────────────────────────────────────────

    @Test
    fun `Betraege enthalten Zahl und Waehrung`() {
        val s = fmtMoney(1234.5, Waehrung("CHF"))
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
        val s = fmtMoney(10.0, Waehrung("XYZ123"))
        assert(s.contains("10")) { "Der Betrag muss auch ohne bekannte Währung erscheinen: $s" }
    }

    @Test
    fun `fehlender Betrag ergibt einen Gedankenstrich`() {
        assertEquals("—", fmtMoneyOrDash(null as String?, Waehrung("CHF")))
        assertEquals("—", fmtMoneyOrDash("keine Zahl", Waehrung("CHF")))
        assert(fmtMoneyOrDash("12.5", Waehrung("CHF")).contains("12")) { "gültiger Wert muss durchkommen" }
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

    private fun withDevice(tag: String, block: () -> Unit) {
        val vorher = Locale.getDefault()
        Locale.setDefault(Locale.forLanguageTag(tag))
        try { block() } finally { Locale.setDefault(vorher) }
    }

    @Test
    fun `de-DE schreibt Punkt und Komma, de-CH Hochkomma und Punkt`() {
        withDevice("de-DE") { assertEquals("4.894,77", fmtAmount(4894.77)) }
        withDevice("de-CH") { assertEquals("4\u2019894.77", fmtAmount(4894.77)) }
        withDevice("en-US") { assertEquals("4,894.77", fmtAmount(4894.77)) }
    }

    @Test
    fun `ein Eingabefeld bekommt den Betrag ohne Tausendertrennung zurueck`() {
        withDevice("de-DE") { assertEquals("4894,77", fmtEingabe(4894.77)) }
        withDevice("de-CH") { assertEquals("4894.77", fmtEingabe(4894.77)) }
        // So liest AcquisitionManagementRow das Feld beim Speichern.
        withDevice("de-DE") { assertEquals(4894.77, fmtEingabe(4894.77).replace(',', '.').toDouble(), 0.0) }
    }

    @Test
    fun `ohne passende Landesform gelten de-CH und en-GB`() {
        val de = Locale.forLanguageTag("de")
        assertEquals("de-CH", numbersLocale(de, Locale.forLanguageTag("en-US")).toLanguageTag())
        assertEquals("de-CH", numbersLocale(de, de).toLanguageTag())
        assertEquals("en-GB", numbersLocale(Locale.forLanguageTag("fr-FR"), Locale.forLanguageTag("fr-FR")).toLanguageTag())
        assertEquals("Das Land kommt vom Gerät, die Sprache von der App",
            "de-AT", numbersLocale(de, Locale.forLanguageTag("de-AT")).toLanguageTag())
        assertEquals("en-GB", numbersLocale(Locale.forLanguageTag("en"), Locale.forLanguageTag("de-DE")).toLanguageTag())
    }

    /**
     * Wie Intl im Web: „CHF 812.50“ mit festem Leerzeichen, nie „CHF812.50“.
     * Gegenprobe: withCurrencyGap() in fmtMoney entfernt →
     * rot (en-GB ergab „CHF812.50“).
     */
    @Test
    fun `Waehrungscode und Betrag stehen mit festem Leerzeichen`() {
        withDevice("en-GB") {
            assertEquals("CHF\u00A0812.50", fmtMoney(812.5, Waehrung("CHF")))
            assertEquals("-CHF\u00A012.00", fmtMoney(-12.0, Waehrung("CHF")))
            assertEquals("€812.50", fmtMoney(812.5, Waehrung("EUR")))
        }
        withDevice("de-CH") {
            val s = fmtMoney(812.5, Waehrung("CHF"))
            assertEquals("CHF\u00A0812.50", s.replace(' ', '\u00A0'))
            assert(!s.contains("\u00A0\u00A0") && !s.contains("  ")) { "doppelter Abstand: $s" }
        }
    }
}
