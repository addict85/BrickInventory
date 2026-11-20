package ch.brickinventoryapp.finanzen.ui.pdf

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import android.content.Context
import ch.brickinventoryapp.model.koroutinen.BrickDispatchers
import ch.brickinventoryapp.model.koroutinen.Dispatcher
import ch.brickinventoryapp.finanzen.ui.viewmodel.pdfWithOnceTicket
import ch.brickinventoryapp.finanzen.ui.viewmodel.showsVouchers
import ch.brickinventoryapp.data.util.INSTRUCTION_DISPLAY_FOLDER
import ch.brickinventoryapp.data.AnleitungsRepository
import ch.brickinventoryapp.data.util.InstructionStore
import ch.brickinventoryapp.data.util.pdfAblage
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject

/** Lädt ein PDF für den Betrachter; [offen] bekommt die Quelle, bevor sie zurückkommt. */
interface PdfLoader {
    suspend fun lade(pdfUrl: String, offen: PdfHolder, onZustand: (PdfLoadState) -> Unit): Pair<PdfQuelle, Int>
}

@Module
@InstallIn(SingletonComponent::class)
internal interface PdfLoaderModule {
    @Binds fun lader(l: AnleitungsLader): PdfLoader
    @Binds fun pages(s: PdfRendererPages): PdfSeitenQuelle
}

/**
 * Download, Ablage und Aufbereitung grosser Anleitungen, ausserhalb der Komposition:
 * Eine Drehung baut den Bildschirm neu, der Download im ViewModel läuft weiter.
 * Anleitungen gehen streamend und verschlüsselt auf die Platte ([InstructionStore]),
 * Gutscheine nur in den Speicher.
 */
internal class AnleitungsLader @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    /** Das Netz liegt in der Datenschicht; hier nur Ablage, Aufbereitung und Seitenzahl. */
    private val netz: AnleitungsRepository,
    private val anleitungen: InstructionStore,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    /** Zählt die Seiten im isolierten Prozess (PdfRenderDienst), zugleich die Lesbarkeitsprobe. */
    private val renderer: PdfRenderConnection,
) : PdfLoader {

    override suspend fun lade(pdfUrl: String, offen: PdfHolder, onZustand: (PdfLoadState) -> Unit): Pair<PdfQuelle, Int> {
        // Ein Gutschein-PDF trägt Nummer und PIN: keine Datei (ablage == null), nur ein
        // Speicherbereich, der mit dem Betrachter vergeht.
        val vertraulich = showsVouchers(pdfUrl)
        val ablage = pdfAblage(ctx.cacheDir, pdfUrl, vertraulich)
        return if (ablage == null) {
            ladeInDenSpeicherUndZaehle(pdfUrl, offen, onZustand)
        } else {
            loadAndCount(pdfUrl, ablage, offen, anzeige = File(ctx.cacheDir, INSTRUCTION_DISPLAY_FOLDER), onZustand = onZustand)
        }
    }

    /**
     * Laden und Seiten zählen — mit einem Selbstheilungsversuch: Ältere Fassungen
     * schrieben direkt unter den fertigen Namen und konnten dort eine abgeschnittene
     * Datei hinterlassen. Scheitert das Öffnen, wird der Zwischenspeicher dieser
     * Anleitung verworfen und einmal neu geladen; ein zweiter Fehlschlag geht durch.
     */
    private suspend fun loadAndCount(
        url: String,
        cacheFile: File,
        offen: PdfHolder,
        anzeige: File,
        onZustand: (PdfLoadState) -> Unit,
    ): Pair<PdfQuelle, Int> {
        var attempt = 0
        while (true) {
            attempt++
            netz.lade(url, cacheFile, einmalig = pdfWithOnceTicket(url)) { geladen, gesamt ->
                val pct = if (gesamt > 0) (geladen * 100 / gesamt).toInt() else 0
                onZustand(PdfLoadState.Downloading(pct, geladen, if (gesamt > 0) gesamt else 0L))
            }
            onZustand(PdfLoadState.Rendering)
            fangeAusserAbbruch {
                return withContext(io) {
                    val quelle = PdfArea.anleitung(anleitungen, cacheFile, anzeige)
                    if (!offen.hold(quelle)) throw CancellationException("Betrachter verlassen")
                    quelle to renderer.seitenzahl(quelle)
                }
            }.onFailure { e ->
                if (attempt >= 2 || pdfWithOnceTicket(url)) throw e
                withContext(io) {
                    cacheFile.delete()
                    File(cacheFile.path + ".part").delete()
                }
                onZustand(PdfLoadState.Downloading(0, 0, 0))
            }
        }
    }

    /**
     * Der Weg für vertrauliche PDFs: ganz in den Speicher ([AnleitungsRepository.loadInTheStorage]), ohne
     * Teildatei und ohne Wiederaufnahme, dann in einen memfd ([PdfArea.speicher]).
     */
    private suspend fun ladeInDenSpeicherUndZaehle(
        url: String,
        offen: PdfHolder,
        onZustand: (PdfLoadState) -> Unit,
    ): Pair<PdfQuelle, Int> {
        val inhalt = netz.loadInTheStorage(url) { geladen, gesamt ->
            val pct = if (gesamt > 0) (geladen * 100 / gesamt).toInt() else 0
            onZustand(PdfLoadState.Downloading(pct, geladen, if (gesamt > 0) gesamt else 0L))
        }
        onZustand(PdfLoadState.Rendering)
        return withContext(io) {
            val quelle = PdfArea.speicher(inhalt)
            if (!offen.hold(quelle)) throw CancellationException("Betrachter verlassen")
            quelle to renderer.seitenzahl(quelle)
        }
    }
}
