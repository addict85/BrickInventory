package ch.brickinventoryapp

import ch.brickinventoryapp.util.BeweisSpeicher
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.ServerBeweis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die App rechnet den Serverbeweis genau wie der Server
 * (routes/auth.ts, POST /serverbeweis).
 *
 * Der Prüfwert unten ist mit Node aus derselben Formel berechnet:
 * HMAC-SHA256(Schlüssel = sha256-Hex des Tokens, Nachricht = Nonce).
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen ServerBeweis.kt):
 *   A  als HMAC-Schlüssel den Token statt seines Hashs → rot: „derselbe
 *      Beweis wie beim Server"
 *   B  in stimmt() die Kleinschreibung weggelassen → rot: „ein Beweis in
 *      Grossbuchstaben gilt auch"
 *   C  das Netz aus dem Speicherschlüssel genommen → rot: „ein Netzwechsel
 *      verlangt einen neuen Beweis"
 *   D  in NetworkPolicy wieder `.box` statt `.fritz.box` → rot: „nur die
 *      Fritzbox-Endung gilt als lokal"
 */
class ServerBeweisTest {
    private val token = "beispiel-token-0123"
    private val nonce = "00112233445566778899aabbccddeeff"
    private val beweis = "40f0e6f573a21aa2743e242b452949e11042e31929cae982eefbadff3dbc2cff"

    @Test
    fun `derselbe Beweis wie beim Server`() {
        assertEquals("6ca0e9d22ff87ea6", ServerBeweis.kennung(token))
        assertEquals(beweis, ServerBeweis.erwartet(token, nonce))
        assertTrue(ServerBeweis.stimmt(token, nonce, beweis))
    }

    @Test
    fun `ein falscher oder fehlender Beweis gilt nicht`() {
        assertFalse(ServerBeweis.stimmt(token, nonce, beweis.replaceFirst('4', '5')))
        assertFalse(ServerBeweis.stimmt("anderer-token", nonce, beweis))
        assertFalse(ServerBeweis.stimmt(token, nonce, null))
    }

    @Test
    fun `ein Beweis in Grossbuchstaben gilt auch`() {
        assertTrue(ServerBeweis.stimmt(token, nonce, beweis.uppercase()))
    }

    @Test
    fun `der Beweis kommt aus der Antwort`() {
        assertEquals(beweis, ServerBeweis.ausAntwort("""{"success":true,"beweis":"$beweis"}"""))
        assertNull(ServerBeweis.ausAntwort("""{"success":false,"code":"token_ungueltig"}"""))
    }

    @Test
    fun `ein Netzwechsel verlangt einen neuen Beweis`() {
        val s = BeweisSpeicher()
        val wlanA = s.schluessel("nas", 3000, "netz-1", token)
        s.merke(wlanA)
        assertTrue(s.bekannt(s.schluessel("nas", 3000, "netz-1", token)))
        assertFalse(s.bekannt(s.schluessel("nas", 3000, "netz-2", token)))
        assertFalse(s.bekannt(s.schluessel("nas", 3000, "netz-1", "neuer-token")))
    }

    @Test
    fun `nur die Fritzbox-Endung gilt als lokal, nicht jede box-Adresse`() {
        assertTrue(NetworkPolicy.isPrivateHost("brick.fritz.box"))
        assertFalse(NetworkPolicy.isPrivateHost("brick.example.box"))
    }
}
