package ch.brickinventoryapp.data.local

import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.contract.UpdateQuantityRequest
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
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.offline.Ausgang.DiscardedItem
import ch.brickinventoryapp.data.local.Baseline.DiscardedChange

/** What the server said about an edit. */
sealed class Sendeergebnis {
    data object Angenommen : Sendeergebnis()
    /** The server refuses (4xx): retrying changes nothing, the edit is discarded. */
    data class Rejected(val meldung: String, val httpCode: Int?) : Sendeergebnis()
    /** Unreachable, timeout, 5xx, session expired: once more later. */
    data object Later : Sendeergebnis()
}

fun interface Bearbeitungssender {
    /** [schluessel] goes along as Idempotency-Key; it is the same on every retry. */
    suspend fun send(b: Editing, schluessel: String): Sendeergebnis
}

/**
 * Classifies a response. 401, 408 and 429 are 4xx but no verdict on the
 * edit — after signing in again or some waiting it succeeds. A 2xx
 * without a body has arrived.
 */
fun classify(r: Ergebnis<*>): Sendeergebnis = when (r) {
    is Ergebnis.Erfolg -> Sendeergebnis.Angenommen
    is Ergebnis.Fehler -> classifyError(r)
}

/** When deleting, „does not exist (any more)“ is the goal: a 404 has arrived, not been refused. */
fun deleteClassify(r: Ergebnis<*>): Sendeergebnis =
    if (r is Ergebnis.Fehler.Server && r.status == 404) Sendeergebnis.Angenommen else classify(r)

// Without an HTTP status the server has not judged (network, break, exception): once more later.
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
     * Should the worker try again later? Not without sign-in, unless
     * the device is locked: then the token has merely not been read yet (readToken).
     */
    fun again(deviceLocked: Boolean): Boolean = when (this) {
        LATER -> true
        FERTIG -> false
        NOT_SIGNED_IN -> deviceLocked
    }
}

/**
 * Sends the outbox in order. An item leaves the outbox only when
 * the server has accepted or refused it; on „later“ it stays in front and
 * everything behind it waits, so that the order holds. The lock prevents
 * a second run (worker and app at once) from sending the same item once more.
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
        // Before sending: what can no longer be read is reported instead of skipped.
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
            // Immediately before every send: the guard attaches the token that applies
            // NOW. After an account switch the item would otherwise go out under a foreign account.
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
        // First record, then remove: if the process dies in between, the hint stays.
        ausgang.rememberDiscarded(bereich, DiscardedItem(p.schluessel.ifBlank { "posten-${p.id}" }, p.bearbeitung.ziel, meldung, code))
        ausgang.entferne(p.id)
        // The local list still carries the edit; reloading restores the server state.
        betroffen += p.bearbeitung.art
    }

    companion object {
        /** With WorkManager's backoff about two days — then it is no longer a dead spot. */
        const val MAX_ATTEMPTS = 20
    }
}

/** Sends an edit with the request that would have gone online (the same mapping), including its key. */
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
