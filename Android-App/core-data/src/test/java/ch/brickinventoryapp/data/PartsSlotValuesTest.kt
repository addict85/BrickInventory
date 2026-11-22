package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.FiguresRepositoryImpl
import ch.brickinventoryapp.data.repository.PartsRepositoryImpl
import ch.brickinventoryapp.model.domain.Recorded
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.PartInventory
import ch.brickinventoryapp.model.domain.PartialKey
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OutboxStorage
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.testing.PathServer
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Parts and figure repository return domain values: a `success: false` from the server
 * is a refusal (its sentence it sends with an error status), the stock of the parts list is filed per requested part.
 *
 * Counter-checks (patches under counter-checks/):
 *   teile-absage-als-erfolg      createLocation() maps without zugesagt → red “a success false …”
 *   teile-bestand-falscher-schluessel  getOwnedParts() looks for „nummer-farbe“ → red “the stock …”
 *   figur-erfasst-ohne-preiszustand    addMinifig() leaves out priceFromCondition → red “adding a figure …”
 */
class PartsSlotValuesTest {

    @Volatile private var area: String? = "a"
    private val store = OfflineStore(StorageInventory(), OutboxStorage(), { area })
    private val paths = PathServer(
        "/api/v1/storage/locations" to """{"success":false}""",
        "/api/v1/parts/owned" to """{"success":true,"bestand":{"3001|5":{"gesamt":7,"lose":2}}}""",
        "/api/v1/minifigs" to """{"success":true,"action":"added","fig_number":"sw0001","price_from_condition":"U"}""",
    )
    private val api = paths.onTick()
    private val parts = PartsRepositoryImpl(api, store, RetryPolicy.ONCE)
    private val figures = FiguresRepositoryImpl(api, store, RetryPolicy.ONCE)

    @After
    fun tearDown() = paths.server.shutdown()

    @Test
    fun `a success false is a refusal`() = runBlocking {
        assertEquals(Outcome.Failure.Refusal(), parts.createLocation("Keller"))
    }

    @Test
    fun `the stock is listed per requested part, what is missing has no entry`() = runBlocking {
        val r = parts.getOwnedParts(listOf(PartialKey("3001", 5), PartialKey("3002", 1)))
        assertEquals(Outcome.Success(mapOf(PartialKey("3001", 5) to PartInventory(total = 7, lose = 2))), r)
    }

    @Test
    fun `adding a figure reports new and the state of the purchase price`() = runBlocking {
        val r = figures.addMinifig("sw0001")
        assertEquals(Outcome.Success(Recorded(created = true, number = "sw0001", priceFromState = Condition.USED)), r)
    }
}
