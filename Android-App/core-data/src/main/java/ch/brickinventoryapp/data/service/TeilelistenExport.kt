package ch.brickinventoryapp.data.service

import android.content.Context
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.fach.PdfFortschritt
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.File
import javax.inject.Inject

/** Warum ein PDF-Export scheiterte; den Satz bildet die Oberfläche. */
sealed interface PdfFehlschlag {
    /** Ein Abruf scheiterte; die Anzeige formuliert ihn wie jeden anderen Abruf. */
    data class Abruf(val fehler: Ergebnis.Error) : PdfFehlschlag

    /** Der Server meldet den Auftrag als gescheitert, mit seinem Satz, wenn er einen schickte. */
    data class Auftrag(val satz: String?) : PdfFehlschlag
}

/** Ausgang eines PDF-Exports: die Datei oder der Grund. */
sealed interface ExportErgebnis {
    data class Datei(val datei: File) : ExportErgebnis
    data class Fehler(val grund: PdfFehlschlag) : ExportErgebnis
}

/** Der PDF-Export als Vordergrund-Dienst, der länger lebt als der Bildschirm; im Test ein Double. */
interface TeilelistenExport {
    /** Wo ein laufender Export steht, null ohne Export. */
    val fortschritt: Flow<PdfFortschritt?>
    suspend fun erzeuge(rumpf: String): ExportErgebnis
}

/** Startet den Vordergrund-Dienst mit dem Auftrag; der Context bleibt hier und erreicht kein ViewModel. */
internal class DienstExport @Inject constructor(
    private val manager: PdfExportManager,
    @param:ApplicationContext private val ctx: Context,
) : TeilelistenExport {
    override val fortschritt: Flow<PdfFortschritt?> = manager.state.map { (it as? PdfExportState.Running)?.fortschritt }

    override suspend fun erzeuge(rumpf: String): ExportErgebnis {
        manager.beauftrage(rumpf)
        PdfExportService.start(ctx)
        return when (val r = manager.state.first { it is PdfExportState.Done || it is PdfExportState.Error }) {
            is PdfExportState.Done -> ExportErgebnis.Datei(r.file)
            is PdfExportState.Error -> ExportErgebnis.Fehler(r.grund)
            // Ohne else-Zweig, damit ein neuer Zustand hier auffällt; first{} lässt beide nicht durch.
            is PdfExportState.Idle, is PdfExportState.Running ->
                ExportErgebnis.Fehler(PdfFehlschlag.Abruf(Ergebnis.Error.Unbekannt()))
        }
    }
}

@Module
@InstallIn(SingletonComponent::class)
internal interface TeilelistenExportModul {
    @Binds fun export(e: DienstExport): TeilelistenExport
}
