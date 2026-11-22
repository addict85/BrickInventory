package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.data.repository.AccountDataDeleter
import ch.brickinventoryapp.data.repository.AccountDataDeletion
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.AccountRepositoryImpl
import ch.brickinventoryapp.data.repository.AdminRepositoryImpl
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.AlarmRepositoryImpl
import ch.brickinventoryapp.data.repository.CatalogRepository
import ch.brickinventoryapp.data.repository.CatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.FiguresRepositoryImpl
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.FinancesRepositoryImpl
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.HouseholdRepositoryImpl
import ch.brickinventoryapp.data.repository.ManagementRepository
import ch.brickinventoryapp.data.repository.MinifigsRepository
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.PartsRepositoryImpl
import ch.brickinventoryapp.data.repository.SetCatalogRepository
import ch.brickinventoryapp.data.repository.SetCatalogRepositoryImpl
import ch.brickinventoryapp.data.repository.SetFilesRepository
import ch.brickinventoryapp.data.repository.SetFilesRepositoryImpl
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.data.repository.StepBindingImpl
import ch.brickinventoryapp.data.repository.VouchersRepository
import ch.brickinventoryapp.data.repository.VouchersRepositoryImpl
import ch.brickinventoryapp.data.repository.WantedListRepositoryImpl
import ch.brickinventoryapp.data.repository.WantedRepository
import ch.brickinventoryapp.model.step.StepBinding
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** The repositories as interfaces; whoever needs one does not see the implementation. */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class RepositoryModule {
    @Binds abstract fun sets(r: SetsRepositoryImpl): SetsRepository
    @Binds abstract fun wantedList(r: WantedListRepositoryImpl): WantedRepository
    @Binds abstract fun priceAlarms(r: AlarmRepositoryImpl): AlarmRepository
    @Binds abstract fun setCatalog(r: SetCatalogRepositoryImpl): SetCatalogRepository
    @Binds abstract fun setFiles(r: SetFilesRepositoryImpl): SetFilesRepository
    @Binds abstract fun parts(r: PartsRepositoryImpl): PartsRepository
    @Binds abstract fun finances(r: FinancesRepositoryImpl): FinancesRepository
    @Binds abstract fun figures(r: FiguresRepositoryImpl): MinifigsRepository
    @Binds abstract fun household(r: HouseholdRepositoryImpl): HouseholdRepository
    @Binds abstract fun account(r: AccountRepositoryImpl): AccountRepository
    @Binds abstract fun admin(r: AdminRepositoryImpl): ManagementRepository
    @Binds abstract fun catalog(r: CatalogRepositoryImpl): CatalogRepository
    @Binds abstract fun vouchers(r: VouchersRepositoryImpl): VouchersRepository
    @Binds abstract fun accountData(l: AccountDataDeletion): AccountDataDeleter
    @Binds abstract fun stepBinding(s: StepBindingImpl): StepBinding
}
