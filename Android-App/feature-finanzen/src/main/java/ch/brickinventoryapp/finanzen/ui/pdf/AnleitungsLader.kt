package ch.brickinventoryapp.finanzen.ui.pdf

import ch.brickinventoryapp.data.util.fangeAusserAbbruch
import android.content.Context
import ch.brickinventoryapp.data.di.BrickDispatchers
import ch.brickinventoryapp.data.di.Dispatcher
import ch.brickinventoryapp.finanzen.ui.viewmodel.pdfMitEinmalTicket
import ch.brickinventoryapp.finanzen.ui.viewmodel.zeigtGutscheine
import ch.brickinventoryapp.data.util.ANLEITUNG_ANZEIGE_ORDNER
import ch.brickinventoryapp.data.AnleitungsRepository
import ch.brickinventoryapp.data.util.AnleitungsAblage
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
interface PdfLader {
    suspend fun lade(pdfUrl: String, offen: PdfHalter, onZustand: (PdfLoadState) -> Unit): Pair<PdfQuelle, Int>
}

@Module
@InstallIn(SingletonComponent::class)
internal interface PdfLaderModul {
    @Binds fun lader(l: AnleitungsLader): PdfLader
    @Binds fun seiten(s: PdfRendererSeiten): PdfSeitenQuelle
}

/**
 * Download, Ablage und Aufbereitung grosser Anleitungen, ausserhalb der Komposition:
 * Eine Drehung baut den Bildschirm neu, der Download im ViewModel läuft weiter.
 * Anleitungen gehen streamend und verschlüsselt auf die Platte ([AnleitungsAblage]),
 * Gutscheine nur in den Speicher.
 */
class AnleitungsLader @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    /** Das Netz liegt in der Datenschicht; hier nur Ablage, Aufbereitung und Seitenzahl. */
    private val netz: AnleitungsRepository,
    private val anleitungen: AnleitungsAblage,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    /** Zählt die Seiten im isolierten Prozess (PdfRenderDienst), zugleich die Lesbarkeitsprobe. */
    private val renderer: PdfRenderVerbindung,
) : PdfLader {

    override suspend fun lade(pdfUrl: String, offen: PdfHalter, onZustand: (PdfLoadState) -> Unit): Pair<PdfQuelle, Int> {
        // Ein Gutschein-PDF trägt Nummer und PIN: keine Datei (ablage == null), nur ein
        // Speicherbereich, der mit dem Betrachter vergeht.
        val vertraulich = zeigtGutscheine(pdfUrl)
        val ablage = pdfAblage(ctx.cacheDir, pdfUrl, vertraulich)
        return if (ablage == null) {
            ladeInDenSpeicherUndZaehle(pdfUrl, offen, onZustand)
        } else {
            ladeUndZaehle(pdfUrl, ablage, offen, anzeige = File(ctx.cacheDir, ANLEITUNG_ANZEIGE_ORDNER), onZustand = onZustand)
        }
    }

    /**
     * Laden und Seiten zählen — mit einem Selbstheilungsversuch: Ältere Fassungen
     * schrieben direkt unter den fertigen Namen und konnten dort eine abgeschnittene
     * Datei hinterlassen. Scheitert das Öffnen, wird der Zwischenspeicher dieser
     * Anleitung verworfen und einmal neu geladen; ein zweiter Fehlschlag geht durch.
     */
    private suspend fun ladeUndZaehle(
        url: String,
        cacheFile: File,
        offen: PdfHalter,
        anzeige: File,
        onZustand: (PdfLoadState) -> Unit,
    ): Pair<PdfQuelle, Int> {
        var versuch = 0
        while (true) {
            versuch++
            netz.lade(url, cacheFile, einmalig = pdfMitEinmalTicket(url)) { geladen, gesamt ->
                val pct = if (gesamt > 0) (geladen * 100 / gesamt).toInt() else 0
                onZustand(PdfLoadState.Downloading(pct, geladen, if (gesamt > 0) gesamt else 0L))
            }
            onZustand(PdfLoadState.Rendering)
            fangeAusserAbbruch {
                return withContext(io) {
                    val quelle = PdfBereich.anleitung(anleitungen, cacheFile, anzeige)
                    if (!offen.halte(quelle)) throw CancellationException("Betrachter verlassen")
                    quelle to renderer.seitenzahl(quelle)
                }
            }.onFailure { e ->
                if (versuch >= 2 || pdfMitEinmalTicket(url)) throw e
                withContext(io) {
                    cacheFile.delete()
                    File(cacheFile.path + ".part").delete()
                }
                onZustand(PdfLoadState.Downloading(0, 0, 0))
            }
        }
    }

    /**
     * Der Weg für vertrauliche PDFs: ganz in den Speicher ([AnleitungsRepository.ladeInDenSpeicher]), ohne
     * Teildatei und ohne Wiederaufnahme, dann in einen memfd ([PdfBereich.speicher]).
     */
    private suspend fun ladeInDenSpeicherUndZaehle(
        url: String,
        offen: PdfHalter,
        onZustand: (PdfLoadState) -> Unit,
    ): Pair<PdfQuelle, Int> {
        val inhalt = netz.ladeInDenSpeicher(url) { geladen, gesamt ->
            val pct = if (gesamt > 0) (geladen * 100 / gesamt).toInt() else 0
            onZustand(PdfLoadState.Downloading(pct, geladen, if (gesamt > 0) gesamt else 0L))
        }
        onZustand(PdfLoadState.Rendering)
        return withContext(io) {
            val quelle = PdfBereich.speicher(inhalt)
            if (!offen.halte(quelle)) throw CancellationException("Betrachter verlassen")
            quelle to renderer.seitenzahl(quelle)
        }
    }
}
