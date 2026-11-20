package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.repository.AlarmRepositoryImpl
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.StorageExit
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.testing.PfadServer
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Preisalarme und der Vorrat an Lagerorten liegen in der Ablage wie die übrigen
 * Listen: Gelesen wird nur dort, Schreiben zieht sie nach, und ohne Netz bleibt
 * der letzte Stand.
 *
 * Gegenproben (gegenproben/alarm-ohne-nachzug.patch, vorrat-vorgabe-ohne-nachzug.patch):
 *   in AlarmRepositoryImpl.setPreisalarm nur `sicherAufrufen` → rot „ein gesetzter Alarm …“
 *   in LocalApplication.lagerorte der Zweig LocationDefault auf `liste` → rot „Anlegen, Umbenennen …“
 */
class AlarmAndStockStoreTest {

    @Volatile private var bereich: String? = "a"
    private val ablage = Offlineablage(StorageInventory(), StorageExit(), { bereich })
    private val paths = PfadServer(
        "/api/v1/alerts" to """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","direction":"unter","threshold":750.0,"currency_code":"CHF","name":"Falcon"},
            {"set_number":"10294-1","condition":"U","direction":"ueber","threshold":440.0,"currency_code":"CHF","name":"Titanic"}]}""",
        "/api/v1/sets/75192-1/alert" to """{"success":true,"alert":{"set_number":"75192-1","condition":"N","direction":"ueber","threshold":800.0}}""",
        "/api/v1/sets/10294-1/alert" to """{"success":true,"removed":1}""",
        "/api/v1/storage/locations" to """{"success":true,"orte":[{"id":1,"user_id":9,"name":"Keller"},{"id":2,"user_id":9,"name":"Regal"}],
            "vorgabe":{"id":2,"user_id":9,"name":"Regal"}}""",
        "/api/v1/storage/locations/1" to """{"success":true,"ort":{"id":1,"user_id":9,"name":"Estrich"}}""",
        "/api/v1/storage/default" to """{"success":true,"vorgabe":{"id":1,"user_id":9,"name":"Estrich"}}""",
    )
    private val api = paths.imTakt()
    private val alerts = AlarmRepositoryImpl(api, ablage, Wiederholung.EINMAL)
    private val teile = TeileRepositoryImpl(api, ablage, Wiederholung.EINMAL)

    @After
    fun zu() = paths.server.shutdown()

    @Test
    fun `ein gesetzter und ein geloeschter Alarm stehen sofort in der Ablage`() = runBlocking {
        assertTrue(alerts.refreshAlerts() is Ergebnis.Erfolg)
        assertEquals(listOf("75192-1", "10294-1"), alerts.observeAlerts().first().liste.map { it.setNumber })
        assertEquals(listOf(Alarmrichtung.UNTER), alerts.observeAlerts("75192-1").first().liste.map { it.richtung })

        alerts.setPreisalarm("75192-1", Alarmrichtung.UEBER, Geld.aus(800.0)!!, Zustand.NEU)
        val gesetzt = alerts.observeAlerts("75192-1").first().liste.single()
        assertEquals(Alarmrichtung.UEBER to Geld.aus(800.0), gesetzt.richtung to gesetzt.schwelle)
        assertEquals("der Name der Übersicht bleibt", "Falcon", gesetzt.name)

        alerts.deletePriceAlert("10294-1", Zustand.GEBRAUCHT)
        assertEquals(listOf("75192-1"), alerts.observeAlerts().first().liste.map { it.setNumber })
    }

    @Test
    fun `ohne Netz bleibt die zuletzt geholte Liste der Alarme`() = runBlocking {
        alerts.refreshAlerts()
        // Im Takt antwortet PfadServer ohne Netz; abschalten hiesse hier nichts.
        paths.priority = { _, _ -> 503 to """{"success":false}""" }
        assertTrue(alerts.refreshAlerts() is Ergebnis.Fehler)
        assertEquals(2, alerts.observeAlerts().first().liste.size)
    }

    @Test
    fun `Anlegen, Umbenennen und der Stern aendern den Vorrat in der Ablage`() = runBlocking {
        assertTrue(teile.refreshLocationStock() is Ergebnis.Erfolg)
        fun stock() = runBlocking { teile.observeLocationStock().first().liste.map { it.ort.name to it.vorgabe } }
        assertEquals(listOf("Keller" to false, "Regal" to true), stock())
        teile.nameLocationUm(1, alt = "Keller", name = "Estrich")
        teile.setLocationDefault(1)
        assertEquals(listOf("Estrich" to true, "Regal" to false), stock())
    }
}
