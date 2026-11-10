package ch.brickinventoryapp.data.lokal

import ch.brickinventoryapp.data.api.FigurenApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.model.data.model.UpdateQuantityRequest
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.sicherAufrufen
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.offline.Ausgang
import ch.brickinventoryapp.offline.Ausgangsposten
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.offline.Offlineablage

/** Was der Server zu einer Bearbeitung sagte. */
sealed class Sendeergebnis {
    data object Angenommen : Sendeergebnis()
    /** Der Server lehnt ab (4xx): Wiederholen ändert nichts, die Bearbeitung wird verworfen. */
    data class Abgelehnt(val meldung: String, val httpCode: Int?) : Sendeergebnis()
    /** Nicht erreichbar, Zeitüberschreitung, 5xx, Sitzung abgelaufen: später noch einmal. */
    data object Spaeter : Sendeergebnis()
}

fun interface Bearbeitungssender {
    /** [schluessel] geht als Idempotency-Key mit; er ist bei jeder Wiederholung derselbe. */
    suspend fun sende(b: Bearbeitung, schluessel: String): Sendeergebnis
}

/**
 * Ordnet eine Antwort ein. 401, 408 und 429 sind 4xx, aber kein Urteil über die
 * Bearbeitung — nach erneuter Anmeldung oder etwas Warten gelingt sie. Ein 2xx
 * ohne Rumpf ist angekommen.
 */
fun einordnen(r: Ergebnis<*>): Sendeergebnis = when (r) {
    is Ergebnis.Success -> Sendeergebnis.Angenommen
    is Ergebnis.Error -> einordnenFehler(r)
}

/** Beim Löschen ist „gibt es nicht (mehr)“ das Ziel: Ein 404 ist angekommen, nicht abgelehnt. */
fun einordnenLoeschen(r: Ergebnis<*>): Sendeergebnis =
    if (r is Ergebnis.Error.Server && r.status == 404) Sendeergebnis.Angenommen else einordnen(r)

// Ohne HTTP-Status hat der Server nicht geurteilt (Netz, Abriss, Ausnahme): später noch einmal.
private fun einordnenFehler(r: Ergebnis.Error): Sendeergebnis = when (r) {
    is Ergebnis.Error.LeereAntwort -> Sendeergebnis.Angenommen
    is Ergebnis.Error.Server ->
        if (r.status in 400..499 && r.status !in setOf(401, 408, 429)) Sendeergebnis.Abgelehnt(r.message, r.status)
        else Sendeergebnis.Spaeter
    is Ergebnis.Error.Abgewiesen, is Ergebnis.Error.Netz, Ergebnis.Error.Zeitueberschreitung,
    Ergebnis.Error.Abgebrochen, Ergebnis.Error.Klartext, is Ergebnis.Error.Unbekannt -> Sendeergebnis.Spaeter
}

enum class Abgleichsergebnis {
    FERTIG, SPAETER, NICHT_ANGEMELDET;

    /**
     * Soll der Arbeiter es später noch einmal versuchen? Ohne Anmeldung nicht, ausser
     * das Gerät ist gesperrt: Dann ist das Token nur noch nicht gelesen (liesToken).
     */
    fun nochmal(geraetGesperrt: Boolean): Boolean = when (this) {
        SPAETER -> true
        FERTIG -> false
        NICHT_ANGEMELDET -> geraetGesperrt
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
) : Ausgangslage {
    private val sperre = Mutex()
    private val _ereignisse = MutableSharedFlow<Abgleichsereignis>(extraBufferCapacity = 16)
    override val ereignisse: SharedFlow<Abgleichsereignis> = _ereignisse.asSharedFlow()

    override fun offene(): Flow<Int> = ablage.offene()

    override suspend fun planeLiegengebliebenes() {
        if (ablage.wartet()) ablage.planeSenden()
    }

    suspend fun sende(): Abgleichsergebnis = sperre.withLock {
        val bereich = ablage.bereich() ?: return@withLock Abgleichsergebnis.NICHT_ANGEMELDET
        val betroffen = mutableSetOf<Bestandsart>()
        try {
            lauf(bereich, betroffen)
        } finally {
            if (betroffen.isNotEmpty()) _ereignisse.tryEmit(Abgleichsereignis.Gesendet(betroffen))
        }
    }

    private suspend fun lauf(bereich: String, betroffen: MutableSet<Bestandsart>): Abgleichsergebnis {
        var p = ausgang.erster(bereich)
        while (p != null) {
            // Unmittelbar vor jedem Senden: Der Wächter hängt das Token an, das JETZT
            // gilt. Nach einem Konto-Wechsel ginge der Posten sonst unter fremdem Konto raus.
            if (ablage.bereich() != bereich) return Abgleichsergebnis.NICHT_ANGEMELDET
            when (val e = sender.sende(p.bearbeitung, p.schluessel)) {
                Sendeergebnis.Angenommen -> {
                    ausgang.entferne(p.id)
                    betroffen += p.bearbeitung.art
                }
                is Sendeergebnis.Abgelehnt -> verwirf(p, e.meldung, e.httpCode, betroffen)
                Sendeergebnis.Spaeter -> {
                    if (p.versuche + 1 < MAX_VERSUCHE) {
                        ausgang.versuchGescheitert(p.id)
                        return Abgleichsergebnis.SPAETER
                    }
                    verwirf(p, "", null, betroffen)
                }
            }
            p = ausgang.erster(bereich)
        }
        return Abgleichsergebnis.FERTIG
    }

    private suspend fun verwirf(p: Ausgangsposten, meldung: String, code: Int?, betroffen: MutableSet<Bestandsart>) {
        ausgang.entferne(p.id)
        // Die lokale Liste trägt die Bearbeitung noch; neu laden stellt den Serverstand her.
        betroffen += p.bearbeitung.art
        _ereignisse.tryEmit(Abgleichsereignis.Verworfen(p.bearbeitung.ziel, meldung, code))
    }

    companion object {
        /** Mit dem Rückzug von WorkManager rund zwei Tage — dann ist es kein Funkloch mehr. */
        const val MAX_VERSUCHE = 20
    }
}

/** Sendet eine Bearbeitung mit genau der Anfrage, die online gegangen wäre, samt ihrem Schlüssel. */
class ServerSender @Inject constructor(
    private val sets: SetsApi,
    private val teile: TeileApi,
    private val figuren: FigurenApi,
) : Bearbeitungssender {
    override suspend fun sende(b: Bearbeitung, schluessel: String): Sendeergebnis = when (b) {
        is Bearbeitung.SetMenge -> einordnen(sicherAufrufen {
            sets.updateSetQuantity(b.setNumber, UpdateQuantityRequest(quantityDelta = b.schritt), schluessel)
        })
        is Bearbeitung.SetErfassen -> einordnen(sicherAufrufen { sets.addSet(b.anfrage, schluessel) })
        is Bearbeitung.MerkpostenAnlegen -> einordnen(sicherAufrufen { sets.legeMerkpostenAn(b.anfrage, schluessel) })
        is Bearbeitung.MerkpostenLoeschen -> einordnenLoeschen(sicherAufrufen {
            sets.loescheMerkposten(b.setNumber, b.zustand, b.besitzer, schluessel)
        })
        is Bearbeitung.TeilErfassen -> einordnen(sicherAufrufen { teile.addPart(b.anfrage, schluessel) })
        is Bearbeitung.TeilAendern -> einordnen(sicherAufrufen {
            teile.updatePart(b.partNumber, b.colorId, b.anfrage, b.besitzer, schluessel)
        })
        is Bearbeitung.TeilLoeschen -> einordnenLoeschen(sicherAufrufen {
            teile.deletePart(b.partNumber, b.colorId, b.besitzer, schluessel)
        })
        is Bearbeitung.FigurErfassen -> einordnen(sicherAufrufen { figuren.addMinifig(b.anfrage, schluessel) })
        is Bearbeitung.FigurAendern -> einordnen(sicherAufrufen {
            figuren.updateMinifig(b.figNumber, b.anfrage, b.besitzer, schluessel)
        })
        is Bearbeitung.FigurLoeschen -> einordnenLoeschen(sicherAufrufen {
            figuren.deleteMinifig(b.figNumber, b.besitzer, schluessel)
        })
    }
}
