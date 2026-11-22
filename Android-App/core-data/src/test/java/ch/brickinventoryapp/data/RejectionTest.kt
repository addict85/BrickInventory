package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.testing.withRepo
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A 2xx with `success: false` arrives as Ergebnis.Fehler.Absage (the sentence the server sends with an error status),
 * a 2xx with `success: true` as a view: no caller checks the field of the wire format.
 *
 * Counter-check (counter-checks/absage-als-erfolg.patch): `promised` always returns success
 * → red “a refusal of the server is an error”.
 */
class RejectionTest {

    @Test
    fun `a refusal of the server is an error`() = withRepo(::testManagementRepository) { paths, admin ->
        paths.responses["/api/v1/admin/logs"] = """{"success":false}"""
        val r = runBlocking { admin.getLog(15) }
        assertEquals(Outcome.Failure.Refusal(), r)
    }

    @Test
    fun `an acceptance comes as a view`() = withRepo(::testManagementRepository) { paths, admin ->
        paths.responses["/api/v1/admin/logs"] =
            """{"success":true,"logs":[{"id":7,"level":"warn","message":"voll","logged_at":"2026-11-14"}]}"""
        val r = runBlocking { admin.getLog(15) }
        assertEquals(listOf("voll"), (r as Outcome.Success).data.map { it.message })
        assertEquals(7, r.data.single().id)
    }
}
