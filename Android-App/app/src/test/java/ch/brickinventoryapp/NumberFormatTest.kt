package ch.brickinventoryapp

import ch.brickinventoryapp.util.fmtAmount
import ch.brickinventoryapp.util.fmtInt
import ch.brickinventoryapp.util.fmtMoney
import ch.brickinventoryapp.util.fmtMoneyOrDash
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
 * Bewusst NICHT festgenagelt: der genaue Wortlaut der Ausgabe. Ob de-CH das
 * Symbol vor oder hinter den Betrag setzt, entscheidet die Plattform-Locale
 * und kann sich mit einer JDK-Fassung ändern; ein Test darauf wäre eine Falle
 * ohne Aussage über unseren Code.
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
        }
    }

    @Test
    fun `die Sprache entscheidet ueber das Zahlenformat, nicht ein fester Wert`() {
        val u = code(read("util/NumberFormatUtils.kt"))
        assert(u.contains("AppCompatDelegate.getApplicationLocales()")) {
            "Das Format muss der eingestellten APP-Sprache folgen — dieselbe Quelle, " +
                "aus der LanguageManager sie setzt. Sonst laufen App und Webapp auseinander."
        }
        assert(u.contains("de-CH") && u.contains("en-GB")) {
            "Dieselbe Zuordnung wie locale() in public/i18n.js: Deutsch → de-CH, sonst en-GB"
        }
        // Gegenrichtung: getCurrencyInstance macht die Stellung von Symbol und
        // Betrag zur Sache der Locale. Wer hier wieder von Hand zusammensetzt,
        // holt sich die drei Schreibweisen zurück.
        assert(u.contains("getCurrencyInstance")) {
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
}
