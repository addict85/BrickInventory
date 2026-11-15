package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.testing.mitRepo
import ch.brickinventoryapp.testing.testVerwaltungRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Ein 2xx mit `success: false` kommt als Ergebnis.Fehler.Absage mit dem Satz des Servers an,
 * ein 2xx mit `success: true` als Ansicht: Kein Aufrufer prüft das Feld des Wire-Formats.
 *
 * Gegenprobe (gegenproben/absage-als-erfolg.patch): `zugesagt` gibt immer Erfolg zurück
 * → rot „eine Absage des Servers ist ein Fehler mit seinem Satz“.
 */
class AbsageTest {

    @Test
    fun `eine Absage des Servers ist ein Fehler mit seinem Satz`() = mitRepo(::testVerwaltungRepository) { pfade, admin ->
        pfade.antworten["/api/v1/admin/logs"] = """{"success":false,"error":"Protokoll gesperrt"}"""
        val r = runBlocking { admin.getProtokoll(15) }
        assertEquals(Ergebnis.Fehler.Absage("Protokoll gesperrt"), r)
    }

    @Test
    fun `eine Zusage kommt als Ansicht`() = mitRepo(::testVerwaltungRepository) { pfade, admin ->
        pfade.antworten["/api/v1/admin/logs"] =
            """{"success":true,"logs":[{"id":7,"level":"warn","message":"voll","logged_at":"2026-11-14"}]}"""
        val r = runBlocking { admin.getProtokoll(15) }
        assertEquals(listOf("voll"), (r as Ergebnis.Erfolg).data.map { it.message })
        assertEquals(7, r.data.single().id)
    }
}
