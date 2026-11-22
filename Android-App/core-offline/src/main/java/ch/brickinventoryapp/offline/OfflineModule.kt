package ch.brickinventoryapp.offline

import android.content.Context
import androidx.room.Room
import ch.brickinventoryapp.offline.room.InventoryDatabase
import ch.brickinventoryapp.offline.room.RoomOutbox
import ch.brickinventoryapp.offline.room.RoomInventory
import ch.brickinventoryapp.offline.room.EncryptedInventoryFactory
import ch.brickinventoryapp.security.StoreKey
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/** Room behind the interfaces [LocalInventory] and [Outbox]; Room itself stays in this module. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class OfflineModule {
    @Binds abstract fun stock(r: RoomInventory): LocalInventory
    @Binds abstract fun outbox(r: RoomOutbox): Outbox

    companion object {
        @Provides
        @Singleton
        fun database(@ApplicationContext context: Context, store: StoreKey): InventoryDatabase =
            Room.databaseBuilder(context, InventoryDatabase::class.java, InventoryDatabase.NAME)
                // Encrypted with SQLCipher; a plaintext legacy stock is taken over on first opening.
                .openHelperFactory(EncryptedInventoryFactory(context, store))
                .addMigrations(*InventoryDatabase.MIGRATIONS)
                .build()
    }
}
