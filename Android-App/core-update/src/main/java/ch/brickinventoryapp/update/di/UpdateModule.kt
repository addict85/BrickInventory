package ch.brickinventoryapp.update.di

import ch.brickinventoryapp.update.data.UpdateStore
import ch.brickinventoryapp.update.data.UpdateLoader
import ch.brickinventoryapp.update.data.UpdateRepository
import ch.brickinventoryapp.update.util.AndroidUpdateDevice
import ch.brickinventoryapp.update.util.UpdateDevice
import ch.brickinventoryapp.update.util.UpdateStatusStore
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Im Modul der Selbstaktualisierung, weil core-data deren Klassen nicht kennt. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class UpdateModule {
    @Binds abstract fun updateStatus(p: UpdateStore): UpdateStatusStore
    @Binds abstract fun updateDevice(g: AndroidUpdateDevice): UpdateDevice
    @Binds abstract fun update(l: UpdateLoader): UpdateRepository
}
