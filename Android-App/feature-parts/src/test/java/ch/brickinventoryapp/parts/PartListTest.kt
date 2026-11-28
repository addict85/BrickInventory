package ch.brickinventoryapp.parts

import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testSetCatalogRepository
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.parts.ui.PartList
import ch.brickinventoryapp.state.testing.TestServices
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.URLEncoder

/**
 * The temporary parts list, run against a test server: resolve a set
 * and fetch one's own stock for it.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against parts/ui/PartList.kt):
 *   A  the merge key changed to blNum instead of partNumber → red “a set
 *      is merged by Rebrickable number …”, “an image from the CDN …”
 *      and “the stock asks …” (three rows instead of four)
 *   B  name from getSetInfo not taken over (always setNumber) → red “a set
 *      is merged by Rebrickable number …”
 *   C  the branch for https addresses passed through without a proxy → red “an image from the
 *      CDN runs via the server …”
 *   D  in withInventory() always null sent instead of "own" → red “the stock asks
 *      only one's own account without sub-accounts …”
 *   E  in withInventory() loose and total swapped → red, the same case
 *   F  HoldingPart built with blPartNumber → red, the same case (body)
 *   G  on a failed answer computed onward with an empty stock → red “an
 *      error on the stock gives null …”
 *   H  in resolveSetOn() a failed parts fetch taken as an empty list → red “a failed parts
 *      fetch is an error, not an empty list”
 */
class PartListTest {

    private lateinit var paths: PathServer
    private lateinit var t: TestServices
    private lateinit var list: PartList

    private val cdn = "https://cdn.rebrickable.com/media/parts/3001.jpg"

    @Before
    fun setUp() {
        paths = PathServer(
            "/api/v2/sets/info/75192-1" to """{"success":true,"name":"Millennium Falcon"}""",
            "/api/v2/sets/75192-1/parts-list" to """{"success":true,"parts":[
                {"part_number":"3001","bl_part_number":"3001","color_id":1,"total_quantity":2,"image_local":"/images/parts/3001.jpg","image_url":"$cdn"},
                {"part_number":"3001","bl_part_number":"3001","color_id":1,"total_quantity":3},
                {"part_number":"970c00","bl_part_number":"970c00","color_id":0,"total_quantity":1,"image_url":"$cdn"},
                {"part_number":"970c11","bl_part_number":"970c00","color_id":0,"total_quantity":1,"image_url":"/images/parts/970c11.jpg"}
            ]}""",
            "/api/v2/sets/75192-1/minifigs-list" to """{"success":true,"figs":[
                {"fig_number":"sw0001","fig_name":"Han","quantity":1,"total_quantity":2}
            ]}""",
            "/api/v2/parts/owned" to """{"success":true,"holding":{
                "3001|1":{"total":7,"loose":2},
                "970c11|0":{"total":1,"loose":0}
            }}""",
        )
        t = TestServices(paths.server)
        list = PartList(testSetCatalogRepository(t.api), testPartsRepository(t.api))
    }

    @After
    fun tearDown() {
        t.cleanUp()
        paths.server.shutdown()
    }

    @Test
    fun `a set is grouped by Rebrickable number and carries the catalog name`() = runBlocking {
        val (name, rows) = list.resolveSetOn("75192-1", "http://srv/").data()
        assertEquals("Millennium Falcon", name)
        assertEquals(listOf("3001", "970c00", "970c11", "sw0001"), rows.map { it.partNumber })
        assertEquals(5, rows.single { it.partNumber == "3001" }.quantity)
        // Same BrickLink number, different Rebrickable parts: two rows.
        assertEquals("970c00", rows.single { it.partNumber == "970c11" }.blPartNumber)
        val figure = rows.single { it.isFig }
        assertEquals(2, figure.quantity)
    }

    @Test
    fun `an image from the CDN runs via the server and a local image goes first`() = runBlocking {
        val rows = list.resolveSetOn("75192-1", "http://srv/").data().second
        assertEquals("http://srv/images/parts/3001.jpg", rows.single { it.partNumber == "3001" }.imageUrl)
        assertEquals("http://srv/api/v1/img-proxy?url=" + URLEncoder.encode(cdn, "UTF-8"),
            rows.single { it.partNumber == "970c00" }.imageUrl)
        assertEquals("http://srv/images/parts/970c11.jpg", rows.single { it.partNumber == "970c11" }.imageUrl)
    }

    @Test
    fun `the stock asks only the own account without sub-accounts and optionally counts only loose parts`() = runBlocking {
        val rows = list.resolveSetOn("75192-1", "http://srv").data().second.filter { !it.isFig }

        val loose = list.withInventory(rows, onlyLose = true, withSubAccounts = false)!!
        assertEquals(listOf(2, 0, 0), loose.map { it.present })
        assertTrue(paths.requestsTo("POST /api/v2/parts/owned").single().endsWith("?accounts=own"))
        val body = paths.bodyBytes[paths.requests.indexOfFirst { "parts/owned" in it }]
        assertTrue(body, "\"970c11\"" in body)

        val all = list.withInventory(rows, onlyLose = false, withSubAccounts = true)!!
        assertEquals(listOf(7, 0, 1), all.map { it.present })
        assertFalse(paths.requestsTo("POST /api/v2/parts/owned").last().contains("accounts"))
    }

    @Test
    fun `a failed parts fetch is an error, not an empty list`() = runBlocking {
        paths.codes["/api/v2/sets/75192-1/parts-list"] = 500
        assertTrue(list.resolveSetOn("75192-1", "http://srv") is Outcome.Failure)
    }

    @Test
    fun `an error in the stock gives null instead of a list full of zeros`() = runBlocking {
        paths.codes["/api/v2/parts/owned"] = 500
        val rows = list.resolveSetOn("75192-1", "http://srv").data().second
        assertNull(list.withInventory(rows, onlyLose = false, withSubAccounts = false))
    }
}

private fun <T> Outcome<T>.data(): T = (this as Outcome.Success).data
