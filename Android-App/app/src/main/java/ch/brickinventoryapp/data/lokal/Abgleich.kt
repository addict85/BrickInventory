package ch.brickinventoryapp.data.lokal

import ch.brickinventoryapp.data.api.FigurenApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.data.model.UpdateQuantityRequest
import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.sicherAufrufen
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

/** Was der Server zu einer Bearbeitung sagte. */
sealed class Sendeergebnis {
    data object Angenommen : Sendeergebnis()
    /** Der Server lehnt ab (4xx): Wiederholen ändert nichts, die Bearbeitung wird verworfen. */
    data class Abgelehnt(val meldung: String, val httpCode: Int?) : Sendeergebnis()
    /** Nicht erreichbar, Zeitüberschreitung, 5xx, Sitzung abgelaufen: später noch einmal. */
    data object Spaeter : Sendeergebnis()
}

fun interface Bearbeitungssender {
    suspend fun sende(b: Bearbeitung): Sendeergebnis
}

/**
 * Ordnet eine Antwort ein. 401, 408 und 429 sind 4xx, aber kein Urteil über die
 * Bearbeitung — nach erneuter Anmeldung oder etwas Warten gelingt sie. Ein 2xx
 * ohne Rumpf ist angekommen.
 */
fun einordnen(r: Result<*>): Sendeergebnis = when (r) {
    is Result.Success -> Sendeergebnis.Angenommen
    is Result.Error -> einordnenFehler(r)
}

private fun einordnenFehler(r: Result.Error): Sendeergebnis {
    if (r.art == Fehlerart.LEERE_ANTWORT) return Sendeergebnis.Angenommen
    if (r.transient) return Sendeergebnis.Spaeter
    val code = r.httpCode ?: return Sendeergebnis.Spaeter
    return if (code in 400..499 && code !in setOf(401, 408, 429)) Sendeergebnis.Abgelehnt(r.message, code)
    else Sendeergebnis.Spaeter
}

enum class Abgleichsergebnis { FERTIG, SPAETER, NICHT_ANGEMELDET }

/**
 * Sendet den Ausgang der Reihe nach. Ein Posten verlässt den Ausgang erst, wenn
 * der Server ihn angenommen oder abgelehnt hat; bei „später“ bleibt er vorn und
 * alles dahinter wartet, damit die Reihenfolge hält. Die Sperre verhindert, dass
 * ein zweiter Lauf (Worker und App zugleich) denselben Posten noch einmal schickt.
 */
@Singleton
class Abgleich @Inject constructor(
    private val ablage: Offlineablage,
    private val sender: Bearbeitungssender,
) {
    private val sperre = Mutex()

    suspend fun sende(): Abgleichsergebnis = sperre.withLock {
        val bereich = ablage.bereich() ?: return@withLock Abgleichsergebnis.NICHT_ANGEMELDET
        val betroffen = mutableSetOf<Bestandsart>()
        try {
            lauf(bereich, betroffen)
        } finally {
            if (betroffen.isNotEmpty()) ablage.melde(Abgleichsereignis.Gesendet(betroffen))
        }
    }

    private suspend fun lauf(bereich: String, betroffen: MutableSet<Bestandsart>): Abgleichsergebnis {
        var p = ablage.ausgang.erster(bereich)
        while (p != null) {
            when (val e = sender.sende(p.bearbeitung)) {
                Sendeergebnis.Angenommen -> {
                    ablage.ausgang.entferne(p.id)
                    betroffen += p.bearbeitung.art
                }
                is Sendeergebnis.Abgelehnt -> verwirf(p, e.meldung, e.httpCode, betroffen)
                Sendeergebnis.Spaeter -> {
                    if (p.versuche + 1 < MAX_VERSUCHE) {
                        ablage.ausgang.versuchGescheitert(p.id)
                        return Abgleichsergebnis.SPAETER
                    }
                    verwirf(p, "", null, betroffen)
                }
            }
            // Abgemeldet oder Konto gewechselt: Der Rest gehört nicht mehr diesem Lauf.
            if (ablage.bereich() != bereich) return Abgleichsergebnis.NICHT_ANGEMELDET
            p = ablage.ausgang.erster(bereich)
        }
        return Abgleichsergebnis.FERTIG
    }

    private suspend fun verwirf(p: Ausgangsposten, meldung: String, code: Int?, betroffen: MutableSet<Bestandsart>) {
        ablage.ausgang.entferne(p.id)
        // Die lokale Liste trägt die Bearbeitung noch; neu laden stellt den Serverstand her.
        betroffen += p.bearbeitung.art
        ablage.melde(Abgleichsereignis.Verworfen(p.bearbeitung, meldung, code))
    }

    companion object {
        /** Mit dem Rückzug von WorkManager rund zwei Tage — dann ist es kein Funkloch mehr. */
        const val MAX_VERSUCHE = 20
    }
}

/** Sendet eine Bearbeitung mit genau der Anfrage, die online gegangen wäre. */
class ServerSender @Inject constructor(
    private val sets: SetsApi,
    private val teile: TeileApi,
    private val figuren: FigurenApi,
) : Bearbeitungssender {
    override suspend fun sende(b: Bearbeitung): Sendeergebnis = einordnen(when (b) {
        is Bearbeitung.SetMenge ->
            sicherAufrufen { sets.updateSetQuantity(b.setNumber, UpdateQuantityRequest(quantityDelta = b.schritt)) }
        is Bearbeitung.SetErfassen -> sicherAufrufen { sets.addSet(b.anfrage) }
        is Bearbeitung.MerkpostenAnlegen -> sicherAufrufen { sets.legeMerkpostenAn(b.anfrage) }
        is Bearbeitung.MerkpostenLoeschen -> sicherAufrufen { sets.loescheMerkposten(b.setNumber, b.zustand, b.besitzer) }
        is Bearbeitung.TeilErfassen -> sicherAufrufen { teile.addPart(b.anfrage) }
        is Bearbeitung.TeilAendern -> sicherAufrufen { teile.updatePart(b.partNumber, b.colorId, b.anfrage, b.besitzer) }
        is Bearbeitung.FigurErfassen -> sicherAufrufen { figuren.addMinifig(b.anfrage) }
        is Bearbeitung.FigurAendern -> sicherAufrufen { figuren.updateMinifig(b.figNumber, b.anfrage, b.besitzer) }
    })
}
