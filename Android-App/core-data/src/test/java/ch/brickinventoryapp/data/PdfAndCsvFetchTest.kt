package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.collection.SetFilesRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testSetFilesRepository
import ch.brickinventoryapp.model.domain.PartListJob
import ch.brickinventoryapp.model.domain.RunStatus
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * PDF job and CSV status run like every fetch through safeCall: a
 * network error is temporary, a 401 a rejection, and none carries token or
 * address itself — those are set by the guard (here replaced by the test server).
 *
 * Counter-check (counter-checks/pdf-ohne-sicheraufrufen.patch, only measurable in CI):
 *   startPdfJob catches exceptions itself again and turns them into Unbekannt → red
 *   “a network error is temporary …”
 */
class PdfAndCsvFetchTest {

    private val server = MockWebServer().apply { start() }
    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-pdf-${System.nanoTime()}").apply { mkdirs() }
    private val sets: SetFilesRepository = testSetFilesRepository(TestApi.forTarget(server))

    @After
    fun tearDown() {
        runCatching { server.shutdown() }
        folder.deleteRecursively()
    }

    private fun teardown() = MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START)
    private fun rejected() = TestApi.response("""{"success":false,"error":"Token abgelaufen"}""", code = 401)

    private fun <T> error(r: Outcome<T>): Outcome.Failure {
        assertTrue("expected an error, was $r", r is Outcome.Failure)
        return r as Outcome.Failure
    }

    @Test
    fun `a network error is temporary, for every fetch of job and status`() = runBlocking {
        repeat(4) { server.enqueue(teardown()) }
        val all = listOf(sets.startPdfJob(PartListJob(emptyList(), emptyList())), sets.getPdfJobStatus("j1"), sets.downloadPdf("j1"), sets.getCsvImportStatus())
        for (r in all) {
            val f = error(r)
            assertTrue("$f is not transient", f.transient)
        }
    }

    @Test
    fun `a 401 is a rejection with the server's sentence`() = runBlocking {
        repeat(4) { server.enqueue(rejected()) }
        val all = listOf(sets.startPdfJob(PartListJob(emptyList(), emptyList())), sets.getPdfJobStatus("j1"), sets.downloadPdf("j1"), sets.getCsvImportStatus())
        for (r in all) {
            val f = error(r)
            assertTrue("$f is no rejection", f is Outcome.Failure.Rejected)
            assertEquals("Token abgelaufen", f.message)
        }
    }

    @Test
    fun `the state of a job comes as a domain value, the number from the model`() = runBlocking {
        server.enqueue(TestApi.response("""{"success":true,"jobId":"j7"}"""))
        server.enqueue(TestApi.response("""{"success":true,"status":"running","etaSeconds":12,"missingImages":3}"""))
        server.enqueue(TestApi.response("""{"success":true,"jobId":""}"""))

        assertEquals(Outcome.Success("j7"), sets.startPdfJob(PartListJob(emptyList(), emptyList())))
        val state = (sets.getPdfJobStatus("j7") as Outcome.Success).data
        assertEquals(RunStatus.RUNNING, state.status)
        assertEquals(12.0, state.restSeconds)
        assertNull(state.error)
        assertTrue("no job without a number", sets.startPdfJob(PartListJob(emptyList(), emptyList())) is Outcome.Failure.EmptyResponse)

        val paths = List(3) { server.takeRequest().path }
        assertEquals(listOf("/api/v2/sets/partslist-pdf", "/api/v2/sets/partslist-pdf/status/j7", "/api/v2/sets/partslist-pdf"), paths)
    }
}
