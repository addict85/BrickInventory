package ch.brickinventoryapp.offline

import android.content.Context
import androidx.room.Room
import ch.brickinventoryapp.offline.room.BestandDatenbank
import ch.brickinventoryapp.offline.room.RoomAusgang
import ch.brickinventoryapp.offline.room.RoomBestand
import ch.brickinventoryapp.offline.room.VerschluesselteBestandsfabrik
import ch.brickinventoryapp.sicherheit.Ablageschluessel
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/** Room hinter den Schnittstellen [LokalerBestand] und [Ausgang]; Room selbst bleibt in diesem Modul. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class OfflineModule {
    @Binds abstract fun bestand(r: RoomBestand): LokalerBestand
    @Binds abstract fun ausgang(r: RoomAusgang): Ausgang

    companion object {
        @Provides
        @Singleton
        fun datenbank(@ApplicationContext context: Context, ablage: Ablageschluessel): BestandDatenbank =
            Room.databaseBuilder(context, BestandDatenbank::class.java, BestandDatenbank.NAME)
                // Verschlüsselt mit SQLCipher; ein Klartext-Altbestand wird beim ersten Öffnen übernommen.
                .openHelperFactory(VerschluesselteBestandsfabrik(context, ablage))
                .addMigrations(*BestandDatenbank.MIGRATIONEN)
                .build()
    }
}
