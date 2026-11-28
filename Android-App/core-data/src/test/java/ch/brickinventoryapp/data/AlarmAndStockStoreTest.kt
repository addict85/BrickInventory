package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.collection.AlarmRepositoryImpl
import ch.brickinventoryapp.data.parts.PartsRepositoryImpl
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OutboxStorage
import ch.brickinventoryapp.offline.StorageInventory
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Price alerts and the supply of storage locations lie in the store like the other
 * lists: reading happens only there, writing updates them, and without network
 * the last state stays.
 *
 * Counter-checks (counter-checks/alarm-without-refresh.patch, stock-default-without-refresh.patch):
 *   in AlarmRepositoryImpl.setPriceAlarm only `safeCall` → red “a set and a deleted alert …”
 *   in LocalApplication's storage locations the branch LocationDefault on `list` → red “creating, renaming …”
 */
class AlarmAndStockStoreTest {

    @Volatile private var area: String? = "a"
    private val store = OfflineStore(StorageInventory(), OutboxStorage(), { area })
    private val paths = PathServer(
        "/api/v2/alerts" to """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","direction":"below","threshold":750.0,"currency_code":"CHF","name":"Falcon"},
            {"set_number":"10294-1","condition":"U","direction":"above","threshold":440.0,"currency_code":"CHF","name":"Titanic"}]}""",
        "/api/v2/sets/75192-1/alert" to """{"success":true,"alert":{"set_number":"75192-1","condition":"N","direction":"above","threshold":800.0}}""",
        "/api/v2/sets/10294-1/alert" to """{"success":true,"removed":1}""",
        "/api/v2/storage/locations" to """{"success":true,"locations":[{"id":1,"user_id":9,"name":"Keller"},{"id":2,"user_id":9,"name":"Regal"}],
            "preset":{"id":2,"user_id":9,"name":"Regal"}}""",
        "/api/v2/storage/locations/1" to """{"success":true,"location":{"id":1,"user_id":9,"name":"Estrich"}}""",
        "/api/v2/storage/default" to """{"success":true,"preset":{"id":1,"user_id":9,"name":"Estrich"}}""",
    )
    private val api = paths.onTick()
    private val alerts = AlarmRepositoryImpl(api, store, RetryPolicy.ONCE)
    private val parts = PartsRepositoryImpl(api, store, RetryPolicy.ONCE)

    @After
    fun tearDown() = paths.server.shutdown()

    @Test
    fun `a set and a deleted alert are in the store immediately`() = runBlocking {
        assertTrue(alerts.refreshAlerts() is Outcome.Success)
        assertEquals(listOf("75192-1", "10294-1"), alerts.observeAlerts().first().list.map { it.setNumber })
        assertEquals(listOf(AlarmDirection.BELOW), alerts.observeAlerts("75192-1").first().list.map { it.direction })

        alerts.setPriceAlarm("75192-1", AlarmDirection.OVER, Money.from(800.0)!!, Condition.NEW)
        val set = alerts.observeAlerts("75192-1").first().list.single()
        assertEquals(AlarmDirection.OVER to Money.from(800.0), set.direction to set.threshold)
        assertEquals("the name of the overview stays", "Falcon", set.name)

        alerts.deletePriceAlert("10294-1", Condition.USED)
        assertEquals(listOf("75192-1"), alerts.observeAlerts().first().list.map { it.setNumber })
    }

    @Test
    fun `without network the most recently fetched list of alerts stays`() = runBlocking {
        alerts.refreshAlerts()
        // In ticks PathServer answers without network; switching it off would mean nothing here.
        paths.priority = { _, _ -> 503 to """{"success":false}""" }
        assertTrue(alerts.refreshAlerts() is Outcome.Failure)
        assertEquals(2, alerts.observeAlerts().first().list.size)
    }

    @Test
    fun `creating, renaming and the star change the supply in the store`() = runBlocking {
        assertTrue(parts.refreshLocationStock() is Outcome.Success)
        fun stock() = runBlocking { parts.observeLocationStock().first().list.map { it.location.name to it.default } }
        assertEquals(listOf("Keller" to false, "Regal" to true), stock())
        parts.renameLocation(1, old = "Keller", name = "Estrich")
        parts.setLocationDefault(1)
        assertEquals(listOf("Estrich" to true, "Regal" to false), stock())
    }
}
