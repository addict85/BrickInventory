package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.data.repository.MinifigsRepository
import ch.brickinventoryapp.data.repository.FigurenRepositoryImpl
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.FinanzenRepositoryImpl
import ch.brickinventoryapp.data.repository.VouchersRepository
import ch.brickinventoryapp.data.repository.GutscheineRepositoryImpl
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.HaushaltRepositoryImpl
import ch.brickinventoryapp.data.repository.CatalogRepository
import ch.brickinventoryapp.data.repository.KatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.AccountDataDeleter
import ch.brickinventoryapp.data.repository.AccountDataDeletion
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.KontoRepositoryImpl
import ch.brickinventoryapp.data.repository.WantedRepository
import ch.brickinventoryapp.data.repository.MerklisteRepositoryImpl
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.AlarmRepositoryImpl
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.data.repository.SetFilesRepositoryImpl
import ch.brickinventoryapp.data.repository.SetKatalogRepository
import ch.brickinventoryapp.data.repository.SetCatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.SchrittbindungImpl
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.TeileRepositoryImpl
import ch.brickinventoryapp.data.repository.ManagementRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepositoryImpl
import ch.brickinventoryapp.model.step.Schrittbindung
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** The repositories as interfaces; whoever needs one does not see the implementation. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class RepositoryModule {
    @Binds abstract fun sets(r: SetsRepositoryImpl): SetsRepository
    @Binds abstract fun merkliste(r: MerklisteRepositoryImpl): WantedRepository
    @Binds abstract fun preisalarme(r: AlarmRepositoryImpl): AlarmRepository
    @Binds abstract fun setCatalog(r: SetCatalogRepositoryImpl): SetKatalogRepository
    @Binds abstract fun setFiles(r: SetFilesRepositoryImpl): SetDateienRepository
    @Binds abstract fun teile(r: TeileRepositoryImpl): PartsRepository
    @Binds abstract fun finanzen(r: FinanzenRepositoryImpl): FinancesRepository
    @Binds abstract fun figuren(r: FigurenRepositoryImpl): MinifigsRepository
    @Binds abstract fun haushalt(r: HaushaltRepositoryImpl): HouseholdRepository
    @Binds abstract fun konto(r: KontoRepositoryImpl): AccountRepository
    @Binds abstract fun verwaltung(r: VerwaltungRepositoryImpl): ManagementRepository
    @Binds abstract fun katalog(r: KatalogRepositoryImpl): CatalogRepository
    @Binds abstract fun gutscheine(r: GutscheineRepositoryImpl): VouchersRepository
    @Binds abstract fun accountData(l: AccountDataDeletion): AccountDataDeleter
    @Binds abstract fun schrittbindung(s: SchrittbindungImpl): Schrittbindung
}
