package ch.brickinventoryapp.dienste.service

import ch.brickinventoryapp.vertrag.PdfAuftragAnfrage
import android.content.Context
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.service.ExportErgebnis
import ch.brickinventoryapp.data.service.PdfFehlschlag
import ch.brickinventoryapp.data.service.TeilelistenExport
import ch.brickinventoryapp.model.fach.PdfFortschritt
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/** Startet den Vordergrund-Dienst mit dem Auftrag; der Context bleibt hier und erreicht kein ViewModel. */
internal class DienstExport @Inject constructor(
    private val manager: PdfExportManager,
    @param:ApplicationContext private val ctx: Context,
) : TeilelistenExport {
    override val fortschritt: Flow<PdfFortschritt?> = manager.state.map { (it as? PdfExportState.Running)?.fortschritt }

    override suspend fun erzeuge(auftrag: PdfAuftragAnfrage): ExportErgebnis {
        manager.beauftrage(auftrag)
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
