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
import ch.brickinventoryapp.data.AlarmPlaner
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.CsvImportStrom
import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.data.GeraeteEinstellungen
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.Sitzungsablage
import ch.brickinventoryapp.data.Vertrauensablage
import ch.brickinventoryapp.data.Zugangsdaten
import ch.brickinventoryapp.data.lokal.WorkManagerEntwertung
import ch.brickinventoryapp.service.AndroidCsvImportDienst
import ch.brickinventoryapp.service.CsvImportDienst
import ch.brickinventoryapp.data.EntwertungsPlaner

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
    @Binds abstract fun geraet(p: PreferencesManager): GeraeteEinstellungen
    @Binds abstract fun sitzungsablage(p: PreferencesManager): Sitzungsablage
    @Binds abstract fun darstellung(p: PreferencesManager): Darstellungsablage
    @Binds abstract fun vertrauensablage(p: PreferencesManager): Vertrauensablage
    @Binds abstract fun zugang(p: PreferencesManager): Zugangsdaten
    @Binds abstract fun csvStrom(c: CsvImportSseClient): CsvImportStrom
    @Binds abstract fun csvDienst(d: AndroidCsvImportDienst): CsvImportDienst
    @Binds abstract fun alarm(p: WorkManagerAlarmPlaner): AlarmPlaner

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
