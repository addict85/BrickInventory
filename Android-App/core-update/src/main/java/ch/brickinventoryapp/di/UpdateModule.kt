package ch.brickinventoryapp.di

import ch.brickinventoryapp.data.UpdateAblage
import ch.brickinventoryapp.data.UpdateLader
import ch.brickinventoryapp.data.UpdateRepository
import ch.brickinventoryapp.util.AndroidUpdateGeraet
import ch.brickinventoryapp.util.UpdateGeraet
import ch.brickinventoryapp.util.UpdateStandAblage
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
