package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.offline.Ausgang
import ch.brickinventoryapp.offline.AusgangPlaner
import ch.brickinventoryapp.data.lokal.Abgleich
import ch.brickinventoryapp.data.lokal.Ausgangslage
import ch.brickinventoryapp.data.lokal.Bearbeitungssender
import ch.brickinventoryapp.offline.LokalerBestand
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.data.cache.CacheBesitzer
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.ServerSender
import ch.brickinventoryapp.data.lokal.WorkManagerPlaner
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
import ch.brickinventoryapp.model.koroutinen.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.CsvImportStrom
import ch.brickinventoryapp.data.CsvImportBeobachter
import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.data.GeraeteBereinigung
import ch.brickinventoryapp.data.SitzungsBereinigung
import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.data.GeraeteEinstellungen
import ch.brickinventoryapp.data.GeraeteAblage
import ch.brickinventoryapp.data.KontoAblage
import ch.brickinventoryapp.data.TokenAblage
import ch.brickinventoryapp.data.AnleitungsDownload
import ch.brickinventoryapp.data.AnleitungsRepository
import ch.brickinventoryapp.data.Tokenspiegel
import ch.brickinventoryapp.data.Tokenuebernahme
import ch.brickinventoryapp.data.Netzvertrauen
import ch.brickinventoryapp.data.Alarmablage
import ch.brickinventoryapp.data.Entwertungsprotokoll
import ch.brickinventoryapp.data.Sprachablage
import ch.brickinventoryapp.data.Sitzungsablage
import ch.brickinventoryapp.data.Vertrauensablage
import ch.brickinventoryapp.data.Zugangsdaten
import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.data.Sitzungsende
import ch.brickinventoryapp.data.lokal.WorkManagerEntwertung
import ch.brickinventoryapp.data.EntwertungsPlaner
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.cache.Vorschauablage
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.MeldungsWarteschlange
import ch.brickinventoryapp.data.PasswortPflicht
import ch.brickinventoryapp.data.PasswortPflichtZustand
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.data.ZweiterFaktorZustand

/**
 * Die lokale Ablage: Room (core-offline) für Listen und Ausgang, WorkManager fürs
 * Senden. Die Logik (Offlineablage, Abgleich) kennt nur die Schnittstellen und ist
 * so ohne Android prüfbar.
 */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class LokalModule {
    @Binds abstract fun planer(p: WorkManagerPlaner): AusgangPlaner
    @Binds abstract fun entwertung(p: WorkManagerEntwertung): EntwertungsPlaner
    @Binds abstract fun sender(s: ServerSender): Bearbeitungssender
    @Binds abstract fun ausgangslage(a: Abgleich): Ausgangslage
    @Binds abstract fun geraet(p: GeraeteAblage): GeraeteEinstellungen
    @Binds abstract fun sitzungsablage(p: KontoAblage): Sitzungsablage
    @Binds abstract fun darstellung(p: GeraeteAblage): Darstellungsablage
    @Binds abstract fun vertrauensablage(p: GeraeteAblage): Vertrauensablage
    @Binds abstract fun netzvertrauen(p: GeraeteAblage): Netzvertrauen
    @Binds abstract fun alarmablage(p: GeraeteAblage): Alarmablage
    @Binds abstract fun entwertungsprotokoll(p: GeraeteAblage): Entwertungsprotokoll
    @Binds abstract fun sprachablage(p: GeraeteAblage): Sprachablage
    @Binds abstract fun zugang(p: TokenAblage): Zugangsdaten
    @Binds abstract fun anmeldestand(p: TokenAblage): Anmeldestand
    @Binds abstract fun sitzungsende(p: TokenAblage): Sitzungsende
    @Binds abstract fun tokenspiegel(p: TokenAblage): Tokenspiegel
    @Binds abstract fun tokenuebernahme(p: TokenAblage): Tokenuebernahme
    @Binds abstract fun anleitungen(d: AnleitungsDownload): AnleitungsRepository
    @Binds abstract fun csvStrom(c: CsvImportSseClient): CsvImportStrom
    @Binds abstract fun csvImport(b: CsvImportBeobachter): CsvImportRepository
    @Binds abstract fun bereinigung(b: GeraeteBereinigung): SitzungsBereinigung
    @Binds abstract fun vorschauablage(v: VorschauSpeicher): Vorschauablage
    @Binds abstract fun meldungen(m: MeldungsWarteschlange): MeldungsKanal
    @Binds abstract fun passwortPflicht(p: PasswortPflichtZustand): PasswortPflicht
    @Binds abstract fun faktorPflicht(z: ZweiterFaktorZustand): ZweiterFaktorPflicht

    companion object {
        /**
         * Der Bereich kommt aus dem angemeldeten Konto, gestreut wie im Antwort-Zwischenspeicher:
         * zum Schreiben jetzt gefragt, zum Beobachten als StateFlow der Sitzung.
         */
        @Provides
        @Singleton
        fun offlineablage(bestand: LokalerBestand, ausgang: Ausgang, besitzer: CacheBesitzer, planer: AusgangPlaner,
                          @ApplicationScope bereich: CoroutineScope): Offlineablage =
            Offlineablage(bestand, ausgang, bereichQuelle = { besitzer.kontoBereich()?.let { ResponseCache.bereichsName(it) } },
                planer = planer,
                bereichFluss = besitzer.kontoBereichFluss().map { it?.let(ResponseCache::bereichsName) }
                    .stateIn(bereich, SharingStarted.Eagerly, null))
    }
}
