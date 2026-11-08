package ch.brickinventoryapp.update.di

import ch.brickinventoryapp.update.data.UpdateAblage
import ch.brickinventoryapp.update.data.UpdateLader
import ch.brickinventoryapp.update.data.UpdateRepository
import ch.brickinventoryapp.update.util.AndroidUpdateGeraet
import ch.brickinventoryapp.update.util.UpdateGeraet
import ch.brickinventoryapp.update.util.UpdateStandAblage
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Im Modul der Selbstaktualisierung, weil core-data deren Klassen nicht kennt. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class UpdateModule {
    @Binds abstract fun updateStand(p: UpdateAblage): UpdateStandAblage
    @Binds abstract fun updateGeraet(g: AndroidUpdateGeraet): UpdateGeraet
    @Binds abstract fun update(l: UpdateLader): UpdateRepository
}
