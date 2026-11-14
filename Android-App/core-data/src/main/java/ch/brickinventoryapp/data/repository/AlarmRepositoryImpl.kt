package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.vertrag.PendingAlertsResponse
import ch.brickinventoryapp.vertrag.Preisalarm
import ch.brickinventoryapp.vertrag.PreisalarmRequest
import ch.brickinventoryapp.vertrag.PreisalarmResponse
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.Offlineablage.Nachzug
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Preisalarme über Retrofit; Setzen und Löschen ziehen die Ablage nach. */
@Singleton
class AlarmRepositoryImpl @Inject constructor(
    private val api: SetsApi,
    private val ablage: Offlineablage,
    private val wiederholung: Wiederholung,
) : AlarmRepository {

    override suspend fun getPendingAlerts(since: String?): Ergebnis<PendingAlertsResponse> =
        sicherAufrufen { api.getPendingAlerts(since) }

    override fun beobachteAlarme(setNumber: String?): Flow<Lokal<Preisalarm>> =
        if (setNumber == null) ablage.beobachte(Faecher.PREISALARME)
        else ablage.beobachte(Faecher.PREISALARME).map { l -> l.copy(liste = l.liste.filter { it.setNumber == setNumber }) }

    /** Die Übersicht kommt ganz, ohne Seiten. */
    override suspend fun aktualisiereAlarme(): Ergebnis<Unit> =
        ablage.aktualisiereSeitenweise(Faecher.PREISALARME, { it.alerts }, { it.alerts.size }, wiederholung) { _ ->
            sicherAufrufen { api.getAlleAlarme() }
        }

    override suspend fun setPreisalarm(setNumber: String, richtung: Alarmrichtung, schwelle: Double,
                                       condition: Zustand): Ergebnis<PreisalarmResponse> =
        ablage.nachgezogen({ r -> r.alert?.takeIf { r.success }?.let { Nachzug.AlarmGesetzt(it) } }) {
            sicherAufrufen { api.setPreisalarm(setNumber, PreisalarmRequest(richtung, schwelle, condition)) }
        }

    override suspend fun deletePreisalarm(setNumber: String, condition: Zustand): Ergebnis<PreisalarmResponse> =
        ablage.nachgezogen({ r -> Nachzug.AlarmEntfernt(setNumber, condition).takeIf { r.success } }) {
            sicherAufrufen { api.deletePreisalarm(setNumber, condition.kennung) }
        }
}
