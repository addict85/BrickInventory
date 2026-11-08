package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.data.repository.FigurenRepositoryImpl
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.FinanzenRepositoryImpl
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.GutscheineRepositoryImpl
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.HaushaltRepositoryImpl
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.KatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.KontoDatenLoescher
import ch.brickinventoryapp.data.repository.KontoDatenLoeschung
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.KontoRepositoryImpl
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepositoryImpl
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Die Repositories als Schnittstellen; wer eins braucht, sieht die Umsetzung nicht. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class RepositoryModule {
    @Binds abstract fun sets(r: SetsRepositoryImpl): SetsRepository
    @Binds abstract fun teile(r: TeileRepositoryImpl): TeileRepository
    @Binds abstract fun finanzen(r: FinanzenRepositoryImpl): FinanzenRepository
    @Binds abstract fun figuren(r: FigurenRepositoryImpl): FigurenRepository
    @Binds abstract fun haushalt(r: HaushaltRepositoryImpl): HaushaltRepository
    @Binds abstract fun konto(r: KontoRepositoryImpl): KontoRepository
    @Binds abstract fun verwaltung(r: VerwaltungRepositoryImpl): VerwaltungRepository
    @Binds abstract fun katalog(r: KatalogRepositoryImpl): KatalogRepository
    @Binds abstract fun gutscheine(r: GutscheineRepositoryImpl): GutscheineRepository
    @Binds abstract fun kontoDaten(l: KontoDatenLoeschung): KontoDatenLoescher
}
