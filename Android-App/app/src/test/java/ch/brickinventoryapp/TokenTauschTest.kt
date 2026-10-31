package ch.brickinventoryapp

import ch.brickinventoryapp.data.TokenTausch
import ch.brickinventoryapp.data.Tauschergebnis
import ch.brickinventoryapp.data.model.TokenRotation
import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Der Tausch eines Tokens: speichern vor benutzen, nur einer zugleich, und bei
 * verlorener Antwort ein zweiter Versuch mit dem ALTEN Token.
 *
 * Gegenproben (30.10.2026, gemessen):
 *   A  in TokenTausch `speichere(neu)` hinter das `return` verlegt (nicht
 *      gespeichert) → rot „der neue Token ist gespeichert, bevor der Tausch endet“
 *   B  die Sperre entfernt (`sperre.withLock` → direkt) → rot „zwei Anfragen mit
 *      der Kopfzeile tauschen einmal“ (beide GETAUSCHT, also zweimal rotiert)
 *   C  bei einem transienten Fehler sofort SPAETER statt erneut → rot „eine
 *      verlorene Antwort wird mit dem alten Token wiederholt“
 *   D  den 401-Zweig entfernt → rot „gilt der alte nicht mehr, muss neu gekoppelt werden“
 */
class TokenTauschTest {

    private class Welt {
        var gespeichert = "alt"
        val protokoll = mutableListOf<String>()
        var antworten: MutableList<Result<TokenRotation>> = mutableListOf()
        var bremse: CompletableDeferred<Unit>? = null
        val tausch = TokenTausch(
            token = { gespeichert },
            speichere = { protokoll += "speichere $it"; gespeichert = it },
            rotiere = { alt ->
                protokoll += "rotiere $alt"
                bremse?.await()
                antworten.removeFirstOrNull() ?: Result.Success(TokenRotation(success = true, token = "neu"))
            },
            pausen = listOf(1, 1, 1),
        )
    }

    private val verloren = Result.Error("", transient = true, art = Fehlerart.NETZ)

    @Test
    fun `der neue Token ist gespeichert, bevor der Tausch endet`() = runTest {
        val w = Welt()
        assertEquals(Tauschergebnis.GETAUSCHT, w.tausch.tausche("alt"))
        assertEquals(listOf("rotiere alt", "speichere neu"), w.protokoll)
        assertEquals("neu", w.gespeichert)
    }

    @Test
    fun `zwei Anfragen mit der Kopfzeile tauschen einmal`() = runTest {
        val w = Welt().apply { bremse = CompletableDeferred() }
        val a = async { w.tausch.tausche("alt") }
        val b = async { w.tausch.tausche("alt") }
        repeat(5) { yield() }
        w.bremse!!.complete(Unit)
        assertEquals(setOf(Tauschergebnis.GETAUSCHT, Tauschergebnis.SCHON_GETAUSCHT), setOf(a.await(), b.await()))
        assertEquals(listOf("rotiere alt", "speichere neu"), w.protokoll)
    }

    @Test
    fun `eine verlorene Antwort wird mit dem alten Token wiederholt`() = runTest {
        val w = Welt().apply { antworten = mutableListOf(verloren, verloren) }
        assertEquals(Tauschergebnis.GETAUSCHT, w.tausch.tausche("alt"))
        assertEquals(listOf("rotiere alt", "rotiere alt", "rotiere alt", "speichere neu"), w.protokoll)
    }

    @Test
    fun `gilt der alte nicht mehr, muss neu gekoppelt werden`() = runTest {
        val w = Welt().apply { antworten = mutableListOf(verloren, Result.Error("", httpCode = 401, code = "token_ungueltig")) }
        assertEquals(Tauschergebnis.NEU_KOPPELN, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
    }

    @Test
    fun `bleibt der Server stumm, bleibt der alte Token stehen`() = runTest {
        val w = Welt().apply { antworten = MutableList(10) { verloren } }
        assertEquals(Tauschergebnis.SPAETER, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
        assertEquals(4, w.protokoll.count { it == "rotiere alt" })
    }
}
