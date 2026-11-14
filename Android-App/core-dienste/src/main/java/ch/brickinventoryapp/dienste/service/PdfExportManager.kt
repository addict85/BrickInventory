package ch.brickinventoryapp.dienste.service

import android.content.Context
import ch.brickinventoryapp.data.di.Anwendungsbereiche
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.vertrag.PdfAuftragAnfrage
import ch.brickinventoryapp.data.service.PdfAuftragsStrom
import ch.brickinventoryapp.data.service.PdfFehlschlag
import ch.brickinventoryapp.data.util.Teilelistentresor
import ch.brickinventoryapp.vertrag.PdfAuftragStand
import ch.brickinventoryapp.model.fach.Laufstatus
import ch.brickinventoryapp.model.fach.PdfFortschritt
import ch.brickinventoryapp.model.fach.PdfSchritt
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.roundToLong

/** Wo der Export steht, als Fachwerte; die Sätze bilden Teileliste und Dienst. */
internal sealed interface PdfExportState {
    data object Idle : PdfExportState
    data class Running(val fortschritt: PdfFortschritt) : PdfExportState
    data class Done(val file: File) : PdfExportState
    data class Error(val grund: PdfFehlschlag) : PdfExportState
}

/**
 * Steuert den PDF-Export: Auftrag starten, per SSE auf den Abschluss warten (Abfrage
 * als Rückfall), PDF herunterladen. Der Auftrag läuft im Bereich der Anwendung, damit
 * er den Bildschirm überlebt; der Vordergrund-Dienst hält dabei nur den Prozess wach.
 */
@Singleton
internal class PdfExportManager @Inject constructor(
    private val dateien: SetDateienRepository,
    private val strom: PdfAuftragsStrom,
    private val teilelistentresor: Teilelistentresor,
    private val bereiche: Anwendungsbereiche,
    @param:ApplicationContext private val context: Context,
) {
    private val _state = MutableStateFlow<PdfExportState>(PdfExportState.Idle)
    val state = _state.asStateFlow()

    private var auftrag: Job? = null

    /** Ein neuer Auftrag ersetzt einen laufenden; der Zustand steht sofort auf „startet“. */
    fun beauftrage(anfrage: PdfAuftragAnfrage) {
        auftrag?.cancel()
        _state.value = PdfExportState.Running(PdfFortschritt(PdfSchritt.STARTET))
        auftrag = bereiche.anwendung.launch(bereiche.io) { fuehreAus(anfrage) }
    }

    /** Fünf Versuche mit wachsender Pause: Das fertige PDF liegt manchmal erst kurz nach der Meldung bereit. */
    private suspend fun ladePdf(jobId: String): Ergebnis<ByteArray> {
        var ergebnis: Ergebnis<ByteArray> = dateien.downloadPdf(jobId)
        var pause = 2000L
        repeat(4) {
            if (ergebnis is Ergebnis.Success) return ergebnis
            delay(pause); pause = minOf(pause * 2, 30_000L)
            ergebnis = dateien.downloadPdf(jobId)
        }
        return ergebnis
    }

    suspend fun fuehreAus(anfrage: PdfAuftragAnfrage) {
        fangeAusserAbbruch {
            val jobId = when (val r = dateien.startPdfJob(anfrage)) {
                is Ergebnis.Success -> r.data
                is Ergebnis.Error -> { scheitere(PdfFehlschlag.Abruf(r)); return }
            }
            _state.value = PdfExportState.Running(PdfFortschritt(PdfSchritt.BILDER_LADEN))
            val lauf = Lauf()
            // Neben dem Warten ein Ticker: Aus der Schätzung des Servers (etaSeconds ≈
            // fehlende Bilder) jede Sekunde die Restzeit, aber nur, solange er erstellt.
            val grund = coroutineScope {
                val ticker = launch {
                    while (isActive) {
                        delay(1000)
                        val frist = lauf.fristMs
                        if (lauf.erstellt && frist > 0L) {
                            val rest = ((frist - System.currentTimeMillis() + 999) / 1000L).toInt()
                            _state.value = PdfExportState.Running(PdfFortschritt(PdfSchritt.ERSTELLT, rest))
                        }
                    }
                }
                try { warteAufAuftrag(jobId, lauf) } finally { ticker.cancel() }
            }
            if (grund != null) { scheitere(grund); return }

            _state.value = PdfExportState.Running(PdfFortschritt(PdfSchritt.HERUNTERLADEN))
            when (val r = ladePdf(jobId)) {
                is Ergebnis.Success -> {
                    val file = teilelistentresor.lege(context.filesDir, context.getExternalFilesDir(null), r.data)
                    // Auch verschlüsselt bleibt das Inventar nur, solange jemand es öffnen will.
                    runCatching { TeilelistenAufraeumer.plane(context) }
                    _state.value = PdfExportState.Done(file)
                }
                is Ergebnis.Error -> scheitere(PdfFehlschlag.Abruf(r))
            }
        }.onFailure { e -> scheitere(PdfFehlschlag.Abruf(Ergebnis.Error.Unbekannt(technisch = e.message))) }
    }

    private fun scheitere(grund: PdfFehlschlag) { _state.value = PdfExportState.Error(grund) }

    /** Wartet per SSE auf den Abschluss, sonst per Abfrage. Null heisst fertig, sonst der Grund. */
    private suspend fun warteAufAuftrag(jobId: String, lauf: Lauf): PdfFehlschlag? {
        var ausgang: Ausgang? = null
        strom.beobachte(jobId).takeWhile { e ->
            when (e) {
                is PdfAuftragsStrom.Ereignis.Stand -> { ausgang = wendeAn(e.stand, lauf); ausgang == null }
                PdfAuftragsStrom.Ereignis.Weg -> false
                is PdfAuftragsStrom.Ereignis.Abgelehnt -> { ausgang = Ausgang(PdfFehlschlag.Abruf(e.fehler)); false }
            }
        }.collect { }
        return (ausgang ?: frageAbBisFertig(jobId, lauf)).grund
    }

    /** Null: läuft noch. */
    private fun wendeAn(stand: PdfAuftragStand, lauf: Lauf): Ausgang? {
        lauf.merkeFrist(stand.etaSeconds)
        return when (stand.status) {
            Laufstatus.FERTIG -> {
                lauf.erstellt = false
                _state.value = PdfExportState.Running(PdfFortschritt(PdfSchritt.ABSCHLUSS))
                Ausgang(null)
            }
            Laufstatus.FEHLER -> { lauf.erstellt = false; Ausgang(PdfFehlschlag.Auftrag(stand.error)) }
            Laufstatus.LAEUFT -> { lauf.erstellt = true; null }
            Laufstatus.RUHT, Laufstatus.WARTET, Laufstatus.ABGEBROCHEN, Laufstatus.UNBEKANNT -> null
        }
    }

    /** Rückfall ohne Strom: alle 3 s abfragen, höchstens zehn Minuten, höchstens zehn Fehler in Folge. */
    private suspend fun frageAbBisFertig(jobId: String, lauf: Lauf): Ausgang {
        var fehler = 0
        val bis = System.currentTimeMillis() + 10 * 60 * 1000L
        var zuletzt: Ergebnis.Error = Ergebnis.Error.Zeitueberschreitung
        while (System.currentTimeMillis() < bis) {
            delay(3000)
            when (val r = dateien.getPdfJobStatus(jobId)) {
                is Ergebnis.Success -> { fehler = 0; wendeAn(r.data, lauf)?.let { return it } }
                is Ergebnis.Error -> { zuletzt = r; if (++fehler >= 10) return Ausgang(PdfFehlschlag.Abruf(r)) }
            }
        }
        return Ausgang(PdfFehlschlag.Abruf(zuletzt))
    }

    /** Wie ein Auftrag endete: [grund] null heisst fertig. */
    private class Ausgang(val grund: PdfFehlschlag?)

    /** Was ein einzelner Auftrag über seine Zeit weiss; je Auftrag neu. */
    private class Lauf {
        /** Wann das PDF laut erster Schätzung fertig ist, 0 ohne Schätzung. */
        @Volatile var fristMs = 0L

        /** Nur solange der Server erstellt, zeigt der Ticker eine Restzeit. */
        @Volatile var erstellt = false

        fun merkeFrist(sekunden: Double?) {
            if (fristMs == 0L && sekunden != null && sekunden > 0) fristMs = System.currentTimeMillis() + (sekunden * 1000).roundToLong()
        }
    }
}
