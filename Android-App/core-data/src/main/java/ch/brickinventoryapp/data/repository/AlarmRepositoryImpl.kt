package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.vertrag.PreisalarmRequest
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.model.fach.AlarmabrufView
import ch.brickinventoryapp.model.fach.PriceAlertView
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Local
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.Offlineablage.FollowUp
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Preisalarme über Retrofit; Setzen und Löschen ziehen die Ablage nach. */
@Singleton
class AlarmRepositoryImpl @Inject constructor(
    private val api: SetsApi,
    private val ablage: Offlineablage,
    private val retry: Wiederholung,
) : AlarmRepository {

    override suspend fun getPendingAlerts(since: String?): Ergebnis<AlarmabrufView> =
        sicherAufrufen { api.getPendingAlerts(since) }
            .promised({ it.success }) { r -> AlarmabrufView(r.alerts.map { it.alsAnsicht() }, r.now) }

    override fun observeAlerts(setNumber: String?): Flow<Local<PriceAlertView>> =
        ablage.observe(Slots.PREISALARME).map { l -> l.copy(liste = l.liste.filter { setNumber == null || it.setNumber == setNumber }) }

    /** Die Übersicht kommt ganz, ohne Seiten. */
    override suspend fun refreshAlerts(): Ergebnis<Unit> =
        ablage.refreshPaged(Slots.PREISALARME, { r -> r.alerts.map { it.alsAnsicht() } }, { it.alerts.size }, retry) { _ ->
            sicherAufrufen { api.getAllAlerts() }
        }

    override suspend fun setPreisalarm(setNumber: String, richtung: Alarmrichtung, schwelle: Geld,
                                       condition: Zustand): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> r.alert?.takeIf { r.success }?.let { FollowUp.AlarmSet(it.alsAnsicht()) } }) {
            sicherAufrufen { api.setPreisalarm(setNumber, PreisalarmRequest(direction = richtung, threshold = schwelle.asDouble(), condition = condition)) }
        }.promised({ it.success }) { }

    override suspend fun deletePriceAlert(setNumber: String, condition: Zustand): Ergebnis<Unit> =
        ablage.nachgezogen({ r -> FollowUp.AlarmRemoved(setNumber, condition).takeIf { r.success } }) {
            sicherAufrufen { api.deletePriceAlert(setNumber, condition.kennung) }
        }.promised({ it.success }) { }
}
