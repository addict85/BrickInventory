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
    @Binds abstract fun entwertung(p: ch.brickinventoryapp.data.lokal.WorkManagerEntwertung): ch.brickinventoryapp.data.EntwertungsPlaner
    @Binds abstract fun sender(s: ServerSender): Bearbeitungssender
    @Binds abstract fun geraet(p: ch.brickinventoryapp.data.PreferencesManager): ch.brickinventoryapp.data.GeraeteEinstellungen
    @Binds abstract fun sitzungsablage(p: ch.brickinventoryapp.data.PreferencesManager): ch.brickinventoryapp.data.Sitzungsablage
    @Binds abstract fun darstellung(p: ch.brickinventoryapp.data.PreferencesManager): ch.brickinventoryapp.data.Darstellungsablage
    @Binds abstract fun vertrauensablage(p: ch.brickinventoryapp.data.PreferencesManager): ch.brickinventoryapp.data.Vertrauensablage
    @Binds abstract fun zugang(p: ch.brickinventoryapp.data.PreferencesManager): ch.brickinventoryapp.data.Zugangsdaten
    @Binds abstract fun csvStrom(c: ch.brickinventoryapp.data.CsvImportSseClient): ch.brickinventoryapp.data.CsvImportStrom
    @Binds abstract fun csvDienst(d: ch.brickinventoryapp.service.AndroidCsvImportDienst): ch.brickinventoryapp.service.CsvImportDienst
    @Binds abstract fun alarm(p: ch.brickinventoryapp.alarm.WorkManagerAlarmPlaner): ch.brickinventoryapp.data.AlarmPlaner

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
