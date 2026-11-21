package ch.brickinventoryapp.offline

import android.content.Context
import androidx.room.Room
import ch.brickinventoryapp.offline.room.InventoryDatabase
import ch.brickinventoryapp.offline.room.RoomExit
import ch.brickinventoryapp.offline.room.RoomInventory
import ch.brickinventoryapp.offline.room.EncryptedInventoryFactory
import ch.brickinventoryapp.security.Ablageschluessel
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/** Room behind the interfaces [LocalInventory] and [Ausgang]; Room itself stays in this module. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class OfflineModule {
    @Binds abstract fun bestand(r: RoomInventory): LocalInventory
    @Binds abstract fun ausgang(r: RoomExit): Ausgang

    companion object {
        @Provides
        @Singleton
        fun datenbank(@ApplicationContext context: Context, ablage: Ablageschluessel): InventoryDatabase =
            Room.databaseBuilder(context, InventoryDatabase::class.java, InventoryDatabase.NAME)
                // Encrypted with SQLCipher; a plaintext legacy stock is taken over on first opening.
                .openHelperFactory(EncryptedInventoryFactory(context, ablage))
                .addMigrations(*InventoryDatabase.MIGRATIONS)
                .build()
    }
}
