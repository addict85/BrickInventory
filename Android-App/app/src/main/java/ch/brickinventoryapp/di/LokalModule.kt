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
    @Binds abstract fun sender(s: ServerSender): Bearbeitungssender

    companion object {
        @Provides
        @Singleton
        fun datenbank(@ApplicationContext context: Context): BestandDatenbank =
            Room.databaseBuilder(context, BestandDatenbank::class.java, BestandDatenbank.NAME).build()
    }
}
