package ch.brickinventoryapp

import ch.brickinventoryapp.util.TokenVerschluesselung
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Verschlüsseltes Bearer-Token und die Übernahme der Altbestände (Nachtrag 155).
 *
 * ── Was hier WIE geprüft wird ───────────────────────────────────────────────
 *
 * Die echte Verschlüsselung braucht den Android-Keystore und läuft nur auf
 * einem Gerät. Deshalb steht sie hinter der Schnittstelle
 * TokenVerschluesselung, und geprüft wird hier das, was ohne Gerät prüfbar UND
 * entscheidend ist: die ÜBERNAHME-REGEL. Sie bestimmt, ob eine bestehende
 * Installation nach dem Update noch angemeldet ist — ein Fehler dort meldet
 * jeden Nutzer ab.
 *
 * Die Regel ist hier als ausführbares Modell nachgebaut, mit derselben
 * Reihenfolge wie in PreferencesManager. Zusätzlich prüfen Quelltext-Zusagen
 * weiter unten, dass der echte Code diese Reihenfolge auch hat — ein Modell,
 * das vom Original abweicht, prüft sonst sich selbst.
 */
class TokenTresorTest {

    /** Attrappe: umkehrbar, aber erkennbar anders als der Klartext. */
    private class Attrappe(var kaputt: Boolean = false) : TokenVerschluesselung {
        override fun verschluessle(klartext: String) = "ENC(" + klartext.reversed() + ")"
        override fun entschluessle(gespeichert: String): String? {
            if (kaputt) return null
            if (!gespeichert.startsWith("ENC(") || !gespeichert.endsWith(")")) return null
            return gespeichert.removePrefix("ENC(").removeSuffix(")").reversed()
        }
    }

    /** Nachbau des Ablagemodells: dieselben zwei Schlüssel wie im DataStore. */
    private class Ablage(
        val tresor: TokenVerschluesselung,
        var klartext: String? = null,
        var geheim: String? = null,
    ) {
        /** Entspricht PreferencesManager.authToken */
        fun lies(): String = geheim?.let { tresor.entschluessle(it) } ?: klartext ?: ""

        /** Entspricht PreferencesManager.saveAuthToken */
        fun schreibe(token: String) {
            geheim = tresor.verschluessle(token)
            klartext = null
        }

        /** Entspricht PreferencesManager.uebernehmeAltesToken */
        fun uebernimm(): Boolean {
            val alt = klartext
            return when {
                alt != null && alt.isNotEmpty() -> {
                    geheim = tresor.verschluessle(alt); klartext = null; true
                }
                alt != null -> { klartext = null; false }
                else -> false
            }
        }

        /** Entspricht PreferencesManager.clearSession */
        fun melde_ab() { klartext = null; geheim = null }
    }

    @Test
    fun `ein bestehendes Klartext-Token bleibt nach dem Update lesbar`() {
        // Der wichtigste Fall: Wer die App schon benutzt, darf nicht abgemeldet
        // werden, nur weil die Ablage sich ändert.
        val a = Ablage(Attrappe(), klartext = "altes-token-123")
        assertEquals("altes-token-123", a.lies())
    }

    @Test
    fun `die Uebernahme verschluesselt und entfernt den Klartext`() {
        val a = Ablage(Attrappe(), klartext = "altes-token-123")
        assertTrue("es gab etwas zu uebernehmen", a.uebernimm())
        assertNull("der Klartext muss weg sein — sonst war die Uebung Zierde", a.klartext)
        assertNotEquals("es darf nicht der Klartext sein", "altes-token-123", a.geheim)
        assertEquals("und es muss weiterhin lesbar sein", "altes-token-123", a.lies())
    }

    @Test
    fun `die Uebernahme laeuft nicht zweimal`() {
        val a = Ablage(Attrappe(), klartext = "t")
        assertTrue(a.uebernimm())
        assertFalse("beim zweiten Start gibt es nichts mehr zu tun", a.uebernimm())
        assertEquals("t", a.lies())
    }

    @Test
    fun `ein leerer Alteintrag wird entfernt, gilt aber nicht als Uebernahme`() {
        val a = Ablage(Attrappe(), klartext = "")
        assertFalse(a.uebernimm())
        assertNull(a.klartext)
        assertEquals("", a.lies())
    }

    @Test
    fun `Speichern legt nur noch verschluesselt ab`() {
        val a = Ablage(Attrappe(), klartext = "alt")
        a.schreibe("neu")
        assertNull("der alte Klartext muss beim Schreiben mit verschwinden", a.klartext)
        assertEquals("neu", a.lies())
    }

    @Test
    fun `Abmelden entfernt BEIDE Eintraege`() {
        // Bliebe der alte stehen, waere man nach dem Abmelden ueber den
        // Altbestand wieder angemeldet.
        val a = Ablage(Attrappe(), klartext = "alt", geheim = "ENC(uen)")
        a.melde_ab()
        assertEquals("", a.lies())
        assertNull(a.klartext)
        assertNull(a.geheim)
    }

    @Test
    fun `ein nicht entschluesselbarer Eintrag gilt als kein Token`() {
        // Geraetewechsel, geloeschter Keystore-Schluessel: Das Entschluesseln
        // schlaegt fehl. Richtig ist die Anmeldemaske — NICHT ein stiller
        // Rueckfall auf irgendetwas anderes.
        val a = Ablage(Attrappe(kaputt = true), geheim = "ENC(sinnlos)")
        assertEquals("", a.lies())
    }

    // ── Zusagen an den echten Code ──────────────────────────────────────────
    //
    // Damit das Modell oben nicht bloss sich selbst prueft.

    private fun quelle(rel: String): String =
        File("src/main/java/ch/brickinventoryapp/$rel").readText()

    @Test
    fun `saveAuthToken schreibt verschluesselt und raeumt den Klartext weg`() {
        val src = quelle("data/PreferencesManager.kt")
        val fn = src.substring(
            src.indexOf("suspend fun saveAuthToken"),
            src.indexOf("suspend fun uebernehmeAltesToken"),
        )
        assertTrue("saveAuthToken verschluesselt nicht", fn.contains("tresor.verschluessle"))
        assertTrue("AUTH_TOKEN_ENC wird nicht gesetzt", fn.contains("AUTH_TOKEN_ENC]"))
        assertTrue("der alte Klartext wird nicht entfernt", fn.contains("remove(AUTH_TOKEN)"))
    }

    @Test
    fun `clearSession entfernt beide Token-Eintraege`() {
        val src = quelle("data/PreferencesManager.kt")
        val fn = src.substring(src.indexOf("suspend fun clearSession"))
        assertTrue(fn.contains("remove(AUTH_TOKEN)"))
        assertTrue("nur der alte wird entfernt — der neue bleibt stehen",
            fn.contains("remove(AUTH_TOKEN_ENC)"))
    }

    @Test
    fun `der Lesepfad versucht zuerst den verschluesselten Wert`() {
        val src = quelle("data/PreferencesManager.kt")
        val fn = src.substring(
            src.indexOf("val authToken: Flow<String>"),
            src.indexOf("val username:"),
        )
        val enc = fn.indexOf("AUTH_TOKEN_ENC")
        val alt = fn.indexOf("prefs[AUTH_TOKEN]")
        assertTrue("AUTH_TOKEN_ENC kommt im Lesepfad nicht vor", enc >= 0)
        assertTrue("der Klartext-Rueckfall fehlt — bestehende Nutzer waeren abgemeldet", alt >= 0)
        assertTrue("der verschluesselte Wert muss VOR dem Klartext versucht werden", enc < alt)
    }

    @Test
    fun `die Verschluesselung haengt nicht am Klartext-Rueckfall`() {
        // Der Tresor darf bei einem Fehlschlag NICHT still Klartext liefern.
        val src = quelle("util/TokenTresor.kt")
        val fn = src.substring(src.indexOf("override fun entschluessle"))
        assertTrue("entschluessle gibt bei einem Fehler nicht null zurueck",
            fn.contains("null"))
        assertFalse("es darf kein Rueckfall auf den Eingabewert geben",
            fn.contains("return gespeichert"))
    }
}
