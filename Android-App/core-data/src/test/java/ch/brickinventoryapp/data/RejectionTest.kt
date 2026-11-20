package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.testing.withRepo
import ch.brickinventoryapp.testing.testManagementRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Ein 2xx mit `success: false` kommt als Ergebnis.Fehler.Absage an (den Satz schickt der Server mit einem Fehlerstatus),
 * ein 2xx mit `success: true` als Ansicht: Kein Aufrufer prüft das Feld des Wire-Formats.
 *
 * Gegenprobe (gegenproben/absage-als-erfolg.patch): `promised` gibt immer Erfolg zurück
 * → rot „eine Absage des Servers ist ein Fehler“.
 */
class RejectionTest {

    @Test
    fun `eine Absage des Servers ist ein Fehler`() = withRepo(::testManagementRepository) { paths, admin ->
        paths.antworten["/api/v1/admin/logs"] = """{"success":false}"""
        val r = runBlocking { admin.getLog(15) }
        assertEquals(Ergebnis.Fehler.Absage(), r)
    }

    @Test
    fun `eine Zusage kommt als Ansicht`() = withRepo(::testManagementRepository) { paths, admin ->
        paths.antworten["/api/v1/admin/logs"] =
            """{"success":true,"logs":[{"id":7,"level":"warn","message":"voll","logged_at":"2026-11-14"}]}"""
        val r = runBlocking { admin.getLog(15) }
        assertEquals(listOf("voll"), (r as Ergebnis.Erfolg).data.map { it.message })
        assertEquals(7, r.data.single().id)
    }
}
