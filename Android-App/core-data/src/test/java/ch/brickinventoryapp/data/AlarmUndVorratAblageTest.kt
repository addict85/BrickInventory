package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.repository.AlarmRepositoryImpl
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.SpeicherAusgang
import ch.brickinventoryapp.offline.SpeicherBestand
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
 *   in LokaleAnwendung.lagerorte der Zweig LagerortVorgabe auf `liste` → rot „Anlegen, Umbenennen …“
 */
class AlarmUndVorratAblageTest {

    @Volatile private var bereich: String? = "a"
    private val ablage = Offlineablage(SpeicherBestand(), SpeicherAusgang(), { bereich })
    private val pfade = PfadServer(
        "/api/v1/alerts" to """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":750.0,"currency_code":"CHF","name":"Falcon"},
            {"set_number":"10294-1","condition":"U","richtung":"ueber","schwelle":440.0,"currency_code":"CHF","name":"Titanic"}]}""",
        "/api/v1/sets/75192-1/alert" to """{"success":true,"alert":{"set_number":"75192-1","condition":"N","richtung":"ueber","schwelle":800.0}}""",
        "/api/v1/sets/10294-1/alert" to """{"success":true,"removed":1}""",
        "/api/v1/storage/locations" to """{"success":true,"orte":[{"id":1,"user_id":9,"name":"Keller"},{"id":2,"user_id":9,"name":"Regal"}],
            "vorgabe":{"id":2,"user_id":9,"name":"Regal"}}""",
        "/api/v1/storage/locations/1" to """{"success":true,"ort":{"id":1,"user_id":9,"name":"Estrich"}}""",
        "/api/v1/storage/default" to """{"success":true,"vorgabe":{"id":1,"user_id":9,"name":"Estrich"}}""",
    )
    private val api = pfade.imTakt()
    private val alarme = AlarmRepositoryImpl(api, ablage, Wiederholung.EINMAL)
    private val teile = TeileRepositoryImpl(api, ablage, Wiederholung.EINMAL)

    @After
    fun zu() = pfade.server.shutdown()

    @Test
    fun `ein gesetzter und ein geloeschter Alarm stehen sofort in der Ablage`() = runBlocking {
        assertTrue(alarme.aktualisiereAlarme() is Ergebnis.Success)
        assertEquals(listOf("75192-1", "10294-1"), alarme.beobachteAlarme().first().liste.map { it.setNumber })
        assertEquals(listOf(Alarmrichtung.UNTER), alarme.beobachteAlarme("75192-1").first().liste.map { it.richtung })

        alarme.setPreisalarm("75192-1", Alarmrichtung.UEBER, 800.0, Zustand.NEU)
        val gesetzt = alarme.beobachteAlarme("75192-1").first().liste.single()
        assertEquals(Alarmrichtung.UEBER to 800.0, gesetzt.richtung to gesetzt.schwelle)
        assertEquals("der Name der Übersicht bleibt", "Falcon", gesetzt.name)

        alarme.deletePreisalarm("10294-1", Zustand.GEBRAUCHT)
        assertEquals(listOf("75192-1"), alarme.beobachteAlarme().first().liste.map { it.setNumber })
    }

    @Test
    fun `ohne Netz bleibt die zuletzt geholte Liste der Alarme`() = runBlocking {
        alarme.aktualisiereAlarme()
        pfade.server.shutdown()
        assertTrue(alarme.aktualisiereAlarme() is Ergebnis.Error)
        assertEquals(2, alarme.beobachteAlarme().first().liste.size)
    }

    @Test
    fun `Anlegen, Umbenennen und der Stern aendern den Vorrat in der Ablage`() = runBlocking {
        assertTrue(teile.aktualisiereLagerortVorrat() is Ergebnis.Success)
        fun vorrat() = runBlocking { teile.beobachteLagerortVorrat().first().liste.map { it.ort.name to it.vorgabe } }
        assertEquals(listOf("Keller" to false, "Regal" to true), vorrat())
        teile.benenneLagerortUm(1, alt = "Keller", name = "Estrich")
        teile.setzeLagerortVorgabe(1)
        assertEquals(listOf("Estrich" to true, "Regal" to false), vorrat())
    }
}
