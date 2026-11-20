package ch.brickinventoryapp.data.lokal

import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.vertrag.UpdateQuantityRequest
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.sicherAufrufen
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.offline.Ausgang
import ch.brickinventoryapp.offline.Ausgangsposten
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.model.lokal.StockKind
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.Ausgang.DiscardedItem
import ch.brickinventoryapp.data.lokal.Baseline.DiscardedChange

/** Was der Server zu einer Bearbeitung sagte. */
sealed class Sendeergebnis {
    data object Angenommen : Sendeergebnis()
    /** Der Server lehnt ab (4xx): Wiederholen ändert nichts, die Bearbeitung wird verworfen. */
    data class Rejected(val meldung: String, val httpCode: Int?) : Sendeergebnis()
    /** Nicht erreichbar, Zeitüberschreitung, 5xx, Sitzung abgelaufen: später noch einmal. */
    data object Later : Sendeergebnis()
}

fun interface Bearbeitungssender {
    /** [schluessel] geht als Idempotency-Key mit; er ist bei jeder Wiederholung derselbe. */
    suspend fun send(b: Editing, schluessel: String): Sendeergebnis
}

/**
 * Ordnet eine Antwort ein. 401, 408 und 429 sind 4xx, aber kein Urteil über die
 * Bearbeitung — nach erneuter Anmeldung oder etwas Warten gelingt sie. Ein 2xx
 * ohne Rumpf ist angekommen.
 */
fun classify(r: Ergebnis<*>): Sendeergebnis = when (r) {
    is Ergebnis.Erfolg -> Sendeergebnis.Angenommen
    is Ergebnis.Fehler -> classifyError(r)
}

/** Beim Löschen ist „gibt es nicht (mehr)“ das Ziel: Ein 404 ist angekommen, nicht abgelehnt. */
fun deleteClassify(r: Ergebnis<*>): Sendeergebnis =
    if (r is Ergebnis.Fehler.Server && r.status == 404) Sendeergebnis.Angenommen else classify(r)

// Ohne HTTP-Status hat der Server nicht geurteilt (Netz, Abriss, Ausnahme): später noch einmal.
private fun classifyError(r: Ergebnis.Fehler): Sendeergebnis = when (r) {
    is Ergebnis.Fehler.LeereAntwort -> Sendeergebnis.Angenommen
    is Ergebnis.Fehler.Server ->
        if (r.status in 400..499 && r.status !in setOf(401, 408, 429)) Sendeergebnis.Rejected(r.message, r.status)
        else Sendeergebnis.Later
    is Ergebnis.Fehler.Absage -> Sendeergebnis.Rejected(r.message, null)
    is Ergebnis.Fehler.Abgewiesen, is Ergebnis.Fehler.Netz, Ergebnis.Fehler.Zeitueberschreitung,
    Ergebnis.Fehler.Abgebrochen, Ergebnis.Fehler.Klartext, is Ergebnis.Fehler.Unbekannt -> Sendeergebnis.Later
}

enum class Abgleichsergebnis {
    FERTIG, LATER, NOT_SIGNED_IN;

    /**
     * Soll der Arbeiter es später noch einmal versuchen? Ohne Anmeldung nicht, ausser
     * das Gerät ist gesperrt: Dann ist das Token nur noch nicht gelesen (readToken).
     */
    fun again(deviceLocked: Boolean): Boolean = when (this) {
        LATER -> true
        FERTIG -> false
        NOT_SIGNED_IN -> deviceLocked
    }
}

/**
 * Sendet den Ausgang der Reihe nach. Ein Posten verlässt den Ausgang erst, wenn
 * der Server ihn angenommen oder abgelehnt hat; bei „später“ bleibt er vorn und
 * alles dahinter wartet, damit die Reihenfolge hält. Die Sperre verhindert, dass
 * ein zweiter Lauf (Worker und App zugleich) denselben Posten noch einmal schickt.
 */
@Singleton
class Abgleich @Inject constructor(
    private val ablage: Offlineablage,
    private val ausgang: Ausgang,
    private val sender: Bearbeitungssender,
) : Baseline {
    private val lock = Mutex()
    private val _events = MutableSharedFlow<Abgleichsereignis>(extraBufferCapacity = 16)
    override val events: SharedFlow<Abgleichsereignis> = _events.asSharedFlow()

    override fun offene(): Flow<Int> = ablage.offene()

    override fun discarded(): Flow<List<DiscardedChange>> = ablage.discarded().map { l ->
        l.map { DiscardedChange(it.id, it.ziel, it.meldung, it.httpCode, it.unlesbar) }
    }

    override suspend fun acknowledge(v: DiscardedChange) = ablage.acknowledgeDiscarded(v.id)

    override suspend fun planeLeftover() {
        if (ablage.wartet()) ablage.sendPlane()
    }

    suspend fun send(): Abgleichsergebnis = lock.withLock {
        val bereich = ablage.bereich() ?: return@withLock Abgleichsergebnis.NOT_SIGNED_IN
        val betroffen = mutableSetOf<StockKind>()
        // Vor dem Senden: Was sich nicht mehr lesen lässt, wird gemeldet statt übersprungen.
        ausgang.cleanUnreadable(bereich)
        try {
            lauf(bereich, betroffen)
        } finally {
            if (betroffen.isNotEmpty()) _events.tryEmit(Abgleichsereignis.Sent(betroffen))
        }
    }

    private suspend fun lauf(bereich: String, betroffen: MutableSet<StockKind>): Abgleichsergebnis {
        var p = ausgang.erster(bereich)
        while (p != null) {
            // Unmittelbar vor jedem Senden: Der Wächter hängt das Token an, das JETZT
            // gilt. Nach einem Konto-Wechsel ginge der Posten sonst unter fremdem Konto raus.
            if (ablage.bereich() != bereich) return Abgleichsergebnis.NOT_SIGNED_IN
            when (val e = sender.send(p.bearbeitung, p.schluessel)) {
                Sendeergebnis.Angenommen -> {
                    ausgang.entferne(p.id)
                    betroffen += p.bearbeitung.art
                }
                is Sendeergebnis.Rejected -> discard(bereich, p, e.meldung, e.httpCode, betroffen)
                Sendeergebnis.Later -> {
                    if (p.versuche + 1 < MAX_ATTEMPTS) {
                        ausgang.attemptFailed(p.id)
                        return Abgleichsergebnis.LATER
                    }
                    discard(bereich, p, "", null, betroffen)
                }
            }
            p = ausgang.erster(bereich)
        }
        return Abgleichsergebnis.FERTIG
    }

    private suspend fun discard(bereich: String, p: Ausgangsposten, meldung: String, code: Int?, betroffen: MutableSet<StockKind>) {
        // Erst festhalten, dann entfernen: Stirbt der Prozess dazwischen, bleibt der Hinweis.
        ausgang.rememberDiscarded(bereich, DiscardedItem(p.schluessel.ifBlank { "posten-${p.id}" }, p.bearbeitung.ziel, meldung, code))
        ausgang.entferne(p.id)
        // Die lokale Liste trägt die Bearbeitung noch; neu laden stellt den Serverstand her.
        betroffen += p.bearbeitung.art
    }

    companion object {
        /** Mit dem Rückzug von WorkManager rund zwei Tage — dann ist es kein Funkloch mehr. */
        const val MAX_ATTEMPTS = 20
    }
}

/** Sendet eine Bearbeitung mit der Anfrage, die online gegangen wäre (dieselbe Abbildung), samt ihrem Schlüssel. */
class ServerSender @Inject constructor(
    private val sets: SetsApi,
    private val teile: PartsApi,
    private val figuren: MinifigsApi,
) : Bearbeitungssender {
    override suspend fun send(b: Editing, schluessel: String): Sendeergebnis = when (b) {
        is Editing.SetMenge -> classify(sicherAufrufen {
            sets.updateSetQuantity(b.setNumber, UpdateQuantityRequest(quantityDelta = b.schritt), schluessel)
        })
        is Editing.SetErfassen -> classify(sicherAufrufen { sets.addSet(b.wish.asRequest(), schluessel) })
        is Editing.MerkpostenAnlegen -> classify(sicherAufrufen { sets.legeMerkpostenAn(b.wish.asRequest(), schluessel) })
        is Editing.MerkpostenLoeschen -> deleteClassify(sicherAufrufen {
            sets.deleteWantedItem(b.setNumber, b.zustand.kennung, b.besitzer, schluessel)
        })
        is Editing.TeilErfassen -> classify(sicherAufrufen { teile.addPart(b.erfassung.asRequest(), schluessel) })
        is Editing.TeilAendern -> classify(sicherAufrufen {
            teile.updatePart(b.partNumber, b.colorId, b.aenderung.asRequest(), b.besitzer, schluessel)
        })
        is Editing.TeilLoeschen -> deleteClassify(sicherAufrufen {
            teile.deletePart(b.partNumber, b.colorId, b.besitzer, schluessel)
        })
        is Editing.FigurErfassen -> classify(sicherAufrufen { figuren.addMinifig(b.erfassung.asRequest(), schluessel) })
        is Editing.FigurAendern -> classify(sicherAufrufen {
            figuren.updateMinifig(b.figNumber, b.aenderung.asRequest(), b.besitzer, schluessel)
        })
        is Editing.FigurLoeschen -> deleteClassify(sicherAufrufen {
            figuren.deleteMinifig(b.figNumber, b.besitzer, schluessel)
        })
    }
}
