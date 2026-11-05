package ch.brickinventoryapp.di

import android.content.Context
import androidx.room.Room
import ch.brickinventoryapp.data.lokal.Ausgang
import ch.brickinventoryapp.data.lokal.AusgangPlaner
import ch.brickinventoryapp.data.lokal.Bearbeitungssender
import ch.brickinventoryapp.data.lokal.LokalerBestand
import ch.brickinventoryapp.data.lokal.ServerSender
import ch.brickinventoryapp.data.lokal.WorkManagerPlaner
import ch.brickinventoryapp.data.lokal.room.BestandDatenbank
import ch.brickinventoryapp.data.lokal.room.RoomAusgang
import ch.brickinventoryapp.data.lokal.room.RoomBestand
import ch.brickinventoryapp.data.lokal.room.VerschluesselteBestandsfabrik
import ch.brickinventoryapp.util.Ablageschluessel
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
import ch.brickinventoryapp.alarm.WorkManagerAlarmPlaner
import ch.brickinventoryapp.alarm.PreisalarmDurchgang
import ch.brickinventoryapp.alarm.PreisalarmRepository
import ch.brickinventoryapp.data.AlarmPlaner
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
import ch.brickinventoryapp.data.UpdateAblage
import ch.brickinventoryapp.data.UpdateLader
import ch.brickinventoryapp.data.AnleitungsDownload
import ch.brickinventoryapp.data.AnleitungsRepository
import ch.brickinventoryapp.data.UpdateRepository
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
import ch.brickinventoryapp.util.AndroidUpdateGeraet
import ch.brickinventoryapp.util.UpdateGeraet
import ch.brickinventoryapp.util.UpdateStandAblage
import ch.brickinventoryapp.data.lokal.WorkManagerEntwertung
import ch.brickinventoryapp.service.AndroidCsvImportDienst
import ch.brickinventoryapp.service.CsvImportDienst
import ch.brickinventoryapp.data.EntwertungsPlaner
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.cache.Vorschauablage
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.MeldungsWarteschlange
import ch.brickinventoryapp.data.PasswortPflicht
import ch.brickinventoryapp.data.PasswortPflichtZustand
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.data.ZweiterFaktorZustand
import ch.brickinventoryapp.util.ZertifikatsFrage
import ch.brickinventoryapp.util.ZertifikatsRueckfrage

/**
 * Die lokale Ablage: Room für Listen und Ausgang, WorkManager fürs Senden.
 * Die Logik (Offlineablage, Abgleich) kennt nur die Schnittstellen und ist so
 * ohne Android prüfbar.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class LokalModule {
    @Binds abstract fun bestand(r: RoomBestand): LokalerBestand
    @Binds abstract fun ausgang(r: RoomAusgang): Ausgang
    @Binds abstract fun planer(p: WorkManagerPlaner): AusgangPlaner
    @Binds abstract fun entwertung(p: WorkManagerEntwertung): EntwertungsPlaner
    @Binds abstract fun sender(s: ServerSender): Bearbeitungssender
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
    @Binds abstract fun updateStand(p: UpdateAblage): UpdateStandAblage
    @Binds abstract fun updateGeraet(g: AndroidUpdateGeraet): UpdateGeraet
    @Binds abstract fun update(l: UpdateLader): UpdateRepository
    @Binds abstract fun anleitungen(d: AnleitungsDownload): AnleitungsRepository
    @Binds abstract fun csvStrom(c: CsvImportSseClient): CsvImportStrom
    @Binds abstract fun csvImport(b: CsvImportBeobachter): CsvImportRepository
    @Binds abstract fun bereinigung(b: GeraeteBereinigung): SitzungsBereinigung
    @Binds abstract fun csvDienst(d: AndroidCsvImportDienst): CsvImportDienst
    @Binds abstract fun alarm(p: WorkManagerAlarmPlaner): AlarmPlaner
    @Binds abstract fun preisalarme(d: PreisalarmDurchgang): PreisalarmRepository
    @Binds abstract fun vorschauablage(v: VorschauSpeicher): Vorschauablage
    @Binds abstract fun meldungen(m: MeldungsWarteschlange): MeldungsKanal
    @Binds abstract fun passwortPflicht(p: PasswortPflichtZustand): PasswortPflicht
    @Binds abstract fun faktorPflicht(z: ZweiterFaktorZustand): ZweiterFaktorPflicht
    @Binds abstract fun zertifikatsFrage(z: ZertifikatsRueckfrage): ZertifikatsFrage

    companion object {
        @Provides
        @Singleton
        fun datenbank(@ApplicationContext context: Context, ablage: Ablageschluessel): BestandDatenbank =
            Room.databaseBuilder(context, BestandDatenbank::class.java, BestandDatenbank.NAME)
                // Verschlüsselt mit SQLCipher (sec8 N5); ein Klartext-Altbestand wird beim ersten Öffnen übernommen.
                .openHelperFactory(VerschluesselteBestandsfabrik(context, ablage))
                .addMigrations(*BestandDatenbank.MIGRATIONEN)
                .build()
    }
}
